// =============================================================================
// Content Script Entry
// =============================================================================
//
// Injected into every page by Chrome. Creates the shadow DOM host and renders
// the Agentation toolbar inside it.

import { render } from "preact";
import { createShadowHost, injectStyles, injectCSSText } from "./shadow-host";
import { Toolbar } from "../components/toolbar";
import { COLOR_TOKEN_CSS } from "../components/toolbar/page-toolbar";
import {
  initStorage,
  loadAnnotations,
  getStorageKey,
  loadEndpoint,
  normalizeEndpoint,
  loadBridgeEndpoint,
  loadBridgeTarget,
  type BridgeTarget,
} from "../utils/storage";
import {
  DEFAULT_BRIDGE_ENDPOINT,
  DEFAULT_ENDPOINT,
  STORAGE_KEY_BRIDGE_ENDPOINT,
  STORAGE_KEY_BRIDGE_TARGETS,
  STORAGE_KEY_ENDPOINT,
} from "../shared/constants";
import { generateOutput } from "../utils/generate-output";
import type { Annotation } from "../shared/types";
import type { Message, SubmitResult } from "../shared/messages";

// ── Shared state (read by message handler, updated by toolbar callbacks) ────

let annotationCount = 0;
let toolbarVisible = true;
let currentEndpoint = "";
let currentBridgeEndpoint = "";
let currentBridgeTarget: BridgeTarget = { mode: "existing" };
let submitHandler:
  | ((opts?: { note?: string }) => Promise<SubmitResult>)
  | null = null;

function setSubmitHandler(
  handler: ((opts?: { note?: string }) => Promise<SubmitResult>) | null,
) {
  submitHandler = handler;
}

function updateBadge() {
  try {
    chrome.runtime.sendMessage({
      type: "UPDATE_BADGE",
      count: annotationCount,
    });
  } catch {
    // Service worker not ready
  }
}

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function bootstrap() {
  // 1. Initialise the storage cache before any component renders
  await initStorage();
  currentEndpoint = loadEndpoint();
  currentBridgeEndpoint = loadBridgeEndpoint();
  const origin = window.location.origin;
  currentBridgeTarget = loadBridgeTarget(origin);

  // 2. Load initial annotation count from storage
  const pathname = window.location.pathname;
  const stored = loadAnnotations(pathname);
  annotationCount = stored.length;

  // 3. Create shadow host and inject styles
  const { shadow, container } = createShadowHost();
  const cssUrl = chrome.runtime.getURL("content.css");
  await injectStyles(shadow, cssUrl);
  injectCSSText(shadow, COLOR_TOKEN_CSS);

  // 4. Render toolbar with callbacks to track state
  function renderApp() {
    render(
      toolbarVisible ? (
        <Toolbar
          endpoint={currentEndpoint || undefined}
          bridgeEndpoint={currentBridgeEndpoint || undefined}
          bridgeTarget={currentBridgeTarget}
          onRegisterSubmit={setSubmitHandler}
          onAnnotationAdd={(a: Annotation) => {
            annotationCount++;
            updateBadge();
          }}
          onAnnotationDelete={(a: Annotation) => {
            annotationCount = Math.max(0, annotationCount - 1);
            updateBadge();
          }}
          onAnnotationsClear={() => {
            annotationCount = 0;
            updateBadge();
          }}
        />
      ) : null,
      container,
    );
  }

  renderApp();
  updateBadge();

  // Re-render when endpoints or target preferences change (e.g. edited from popup).
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local") return;
    let changed = false;

    if (changes[STORAGE_KEY_ENDPOINT]) {
      const newValue = changes[STORAGE_KEY_ENDPOINT].newValue;
      currentEndpoint =
        typeof newValue === "string"
          ? newValue === ""
            ? ""
            : normalizeEndpoint(newValue)
          : DEFAULT_ENDPOINT;
      changed = true;
    }

    if (changes[STORAGE_KEY_BRIDGE_ENDPOINT]) {
      const newValue = changes[STORAGE_KEY_BRIDGE_ENDPOINT].newValue;
      currentBridgeEndpoint =
        typeof newValue === "string"
          ? newValue === ""
            ? ""
            : normalizeEndpoint(newValue)
          : DEFAULT_BRIDGE_ENDPOINT;
      changed = true;
    }

    if (changes[STORAGE_KEY_BRIDGE_TARGETS]) {
      const map = changes[STORAGE_KEY_BRIDGE_TARGETS].newValue as
        | Record<string, BridgeTarget>
        | undefined;
      const entry = map?.[origin];
      currentBridgeTarget =
        entry && (entry.mode === "existing" || entry.mode === "new")
          ? entry
          : { mode: "existing" };
      changed = true;
    }

    if (changed) {
      renderApp();
    }
  });

  // 5. Message listener (from popup / background)
  chrome.runtime.onMessage.addListener(
    (message: Message, _sender, sendResponse) => {
      switch (message.type) {
        case "TOGGLE_TOOLBAR":
          toolbarVisible = !toolbarVisible;
          renderApp();
          sendResponse({ active: toolbarVisible });
          break;

        case "GET_STATE":
          sendResponse({
            type: "STATE_RESPONSE",
            active: toolbarVisible,
            annotationCount,
            url: window.location.href,
            origin,
          });
          break;

        case "COPY_MARKDOWN": {
          const annotations = loadAnnotations(pathname);
          const output = generateOutput(annotations, pathname);
          if (output) {
            navigator.clipboard.writeText(output).catch(() => {});
          }
          sendResponse({ ok: true, copied: !!output });
          break;
        }

        case "CLEAR_ANNOTATIONS": {
          // Clear storage for this page, then re-render
          const key = getStorageKey(pathname);
          chrome.storage.local.remove(key);
          annotationCount = 0;
          updateBadge();
          // Force a re-render to clear the toolbar's state
          renderApp();
          sendResponse({ ok: true });
          break;
        }

        case "SUBMIT_TO_ANTIGRAVITY": {
          if (!submitHandler) {
            sendResponse({
              ok: false,
              error: "Toolbar is hidden or not ready on this page.",
            } satisfies SubmitResult);
            return false;
          }
          submitHandler({ note: message.note })
            .then((result) => sendResponse(result))
            .catch((err) =>
              sendResponse({
                ok: false,
                error: err instanceof Error ? err.message : "Submit failed",
              } satisfies SubmitResult),
            );
          return true;
        }
      }
      return true;
    },
  );
}

bootstrap();
