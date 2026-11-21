// =============================================================================
// Constants
// =============================================================================

/** Prefix for annotation storage keys. Keyed by pathname. */
export const STORAGE_KEY_PREFIX = "agentation-annotations-";

/** Key for toolbar hidden state (per origin). */
export const STORAGE_KEY_TOOLBAR_HIDDEN = "agentation-toolbar-hidden";

/** Key for user settings (synced across devices in Phase 2). */
export const STORAGE_KEY_SETTINGS = "agentation-settings";

/** Default MCP server endpoint. */
export const DEFAULT_ENDPOINT = "http://localhost:4747";

/** Key for the configured MCP endpoint. */
export const STORAGE_KEY_ENDPOINT = "agentation-endpoint";

/** Default Antigravity Sidecar bridge endpoint. */
export const DEFAULT_BRIDGE_ENDPOINT = "http://127.0.0.1:4748";

/** Key for the configured Antigravity Sidecar bridge endpoint. */
export const STORAGE_KEY_BRIDGE_ENDPOINT = "agentation-bridge-endpoint";

/** Key for per-origin Antigravity target conversation preferences. */
export const STORAGE_KEY_BRIDGE_TARGETS = "agentation-bridge-targets";

/** ID of the shadow DOM host element injected into the page. */
export const SHADOW_HOST_ID = "agentation-host";

/** Default accent colour (indigo-500). */
export const DEFAULT_ACCENT_COLOR = "#6366F1";
