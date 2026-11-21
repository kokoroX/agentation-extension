// =============================================================================
// Background Service Worker
// =============================================================================
//
// Handles badge updates, keyboard shortcut commands, message routing,
// proxied HTTP requests and SSE streams for the content script.
//
// Proxying matters because host pages (strict CSP, https) cannot talk to
// http://localhost:4747 directly. Requests made from the service worker are
// extension-originated and covered by host_permissions.

import type { Message, ProxyFetchResponse } from "../shared/messages";

// ── Origin stripping rule ───────────────────────────────────────────────────
//
// agentation-mcp rejects non-local Origin headers with 403. Requests from the
// extension carry chrome-extension://<id> as Origin, so strip it for the
// local MCP domains. The server accepts requests without an Origin header.

const ORIGIN_RULE_ID = 1;

async function ensureOriginStripRule(): Promise<void> {
  try {
    await chrome.declarativeNetRequest.updateDynamicRules({
      removeRuleIds: [ORIGIN_RULE_ID],
      addRules: [
        {
          id: ORIGIN_RULE_ID,
          priority: 1,
          action: {
            type: "modifyHeaders" as chrome.declarativeNetRequest.RuleActionType,
            requestHeaders: [
              {
                header: "origin",
                operation:
                  "remove" as chrome.declarativeNetRequest.HeaderOperation,
              },
            ],
          },
          condition: {
            requestDomains: ["localhost", "127.0.0.1"],
            initiatorDomains: [chrome.runtime.id],
            resourceTypes: [
              "xmlhttprequest",
              "other",
            ] as chrome.declarativeNetRequest.ResourceType[],
          },
        },
      ],
    });
  } catch {
    // Rule may already exist or the API is unavailable — non-fatal.
  }
}

// ── Badge ───────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: "#6366F1" });
  void ensureOriginStripRule();
});

chrome.runtime.onStartup.addListener(() => {
  void ensureOriginStripRule();
});

// Keep the rule present across service worker restarts.
void ensureOriginStripRule();

function updateBadge(tabId: number, count: number) {
  const text = count > 0 ? String(count) : "";
  chrome.action.setBadgeText({ text, tabId });
}

// ── Message handler ─────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: Message, sender, sendResponse) => {
    if (message.type === "PROXY_FETCH") {
      (async () => {
        try {
          const res = await fetch(message.url, {
            method: message.options?.method,
            headers: message.options?.headers,
            body: message.options?.body,
          });
          let body: unknown = null;
          try {
            body = await res.json();
          } catch {
            body = null;
          }
          const response: ProxyFetchResponse = {
            ok: res.ok,
            status: res.status,
            body,
          };
          sendResponse(response);
        } catch {
          sendResponse({ ok: false, status: 0, body: null });
        }
      })();
      // Keep the message channel open for the async response.
      return true;
    }

    switch (message.type) {
      case "UPDATE_BADGE":
        if (sender.tab?.id != null) {
          updateBadge(sender.tab.id, message.count);
        }
        break;
    }

    return false;
  },
);

// ── SSE proxy ───────────────────────────────────────────────────────────────
//
// Content scripts open a long-lived port ("agentation-sse") and send
// { type: "SUBSCRIBE", url }. We stream the event source here and forward
// parsed events so host-page CSP never sees the request.

type SseSubscribeMessage = {
  type: "SUBSCRIBE";
  url: string;
};

type SseFrame = {
  event: string;
  data: string;
};

function parseSseBuffer(buffer: string): {
  frames: SseFrame[];
  rest: string;
} {
  const frames: SseFrame[] = [];
  const normalized = buffer.replace(/\r\n/g, "\n");
  const parts = normalized.split("\n\n");
  const rest = parts.pop() ?? "";

  for (const block of parts) {
    let event = "message";
    let data = "";
    for (const line of block.split("\n")) {
      if (line.startsWith(":")) continue;
      if (line.startsWith("event:")) {
        event = line.slice(6).trim();
      } else if (line.startsWith("data:")) {
        const chunk = line.slice(5);
        data += chunk.startsWith(" ") ? chunk.slice(1) : chunk;
      }
    }
    if (data.length > 0) frames.push({ event, data });
  }

  return { frames, rest };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "agentation-sse") return;

  let controller: AbortController | null = null;

  const safePost = (msg: unknown) => {
    try {
      port.postMessage(msg);
    } catch {
      // Port already disconnected.
    }
  };

  port.onMessage.addListener((raw: unknown) => {
    const message = raw as SseSubscribeMessage;
    if (message?.type !== "SUBSCRIBE" || typeof message.url !== "string") {
      return;
    }

    controller?.abort();
    const current = new AbortController();
    controller = current;

    void (async () => {
      try {
        const res = await fetch(message.url, {
          headers: { Accept: "text/event-stream" },
          signal: current.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`SSE request failed: ${res.status}`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const { frames, rest } = parseSseBuffer(buffer);
          buffer = rest;
          for (const frame of frames) {
            safePost({
              type: "SSE_EVENT",
              event: frame.event,
              data: frame.data,
            });
          }
        }

        safePost({ type: "SSE_ERROR" });
      } catch {
        if (!current.signal.aborted) {
          safePost({ type: "SSE_ERROR" });
        }
      }
    })();
  });

  port.onDisconnect.addListener(() => {
    controller?.abort();
    controller = null;
  });
});

// ── Keyboard shortcut ───────────────────────────────────────────────────────

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-toolbar") {
    const [tab] = await chrome.tabs.query({
      active: true,
      currentWindow: true,
    });
    if (tab?.id != null) {
      chrome.tabs.sendMessage(tab.id, { type: "TOGGLE_TOOLBAR" });
    }
  }
});
