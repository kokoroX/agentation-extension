// =============================================================================
// Message Protocol
// =============================================================================
//
// Typed messages passed between content script, background worker, and popup
// via chrome.runtime.sendMessage / chrome.tabs.sendMessage.

// ── Content script → Background ─────────────────────────────────────────────

export type UpdateBadgeMessage = {
  type: "UPDATE_BADGE";
  count: number;
};

// ── Content script → Background proxy ──────────────────────────────────────

export type ProxyFetchMessage = {
  type: "PROXY_FETCH";
  url: string;
  options?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
  };
};

export type ProxyFetchResponse = {
  ok: boolean;
  status: number;
  body: unknown;
};

// ── Popup / Background → Content script ─────────────────────────────────────

export type ToggleToolbarMessage = {
  type: "TOGGLE_TOOLBAR";
};

export type GetStateMessage = {
  type: "GET_STATE";
};

export type CopyMarkdownMessage = {
  type: "COPY_MARKDOWN";
};

export type ClearAnnotationsMessage = {
  type: "CLEAR_ANNOTATIONS";
};

export type SubmitToAntigravityMessage = {
  type: "SUBMIT_TO_ANTIGRAVITY";
  note?: string;
};

export type SubmitResult = {
  ok: boolean;
  error?: string;
  mode?: "existing" | "new";
  conversationId?: string | null;
};

// ── Content script → Popup (responses) ──────────────────────────────────────

export type StateResponse = {
  type: "STATE_RESPONSE";
  active: boolean;
  annotationCount: number;
  url: string;
  origin?: string;
};

// ── Union ───────────────────────────────────────────────────────────────────

export type Message =
  | UpdateBadgeMessage
  | ToggleToolbarMessage
  | GetStateMessage
  | CopyMarkdownMessage
  | ClearAnnotationsMessage
  | SubmitToAntigravityMessage
  | ProxyFetchMessage
  | StateResponse;
