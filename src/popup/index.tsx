// =============================================================================
// Popup Entry
// =============================================================================

import { render } from "preact";
import { useState, useEffect, useCallback } from "preact/hooks";
import type {
  Message,
  StateResponse,
  SubmitResult,
} from "../shared/messages";
import {
  DEFAULT_BRIDGE_ENDPOINT,
  DEFAULT_ENDPOINT,
  STORAGE_KEY_BRIDGE_ENDPOINT,
  STORAGE_KEY_BRIDGE_TARGETS,
  STORAGE_KEY_ENDPOINT,
} from "../shared/constants";
import {
  fetchBridgeConversations,
  setBridgeProject,
  type BridgeConversation,
  type BridgeProject,
} from "../utils/bridge";
import type { BridgeTarget } from "../utils/storage";

function sendToTab<T = unknown>(
  message: Message,
  callback?: (response: T | undefined) => void,
) {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tabId = tabs[0]?.id;
    if (tabId == null) {
      callback?.(undefined);
      return;
    }
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        callback?.(undefined);
        return;
      }
      callback?.(response as T);
    });
  });
}

function truncate(text: string, max = 38): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function Popup() {
  const [state, setState] = useState<StateResponse | null>(null);
  const [copied, setCopied] = useState(false);

  // MCP endpoint
  const [endpoint, setEndpoint] = useState(DEFAULT_ENDPOINT);
  const [endpointSaved, setEndpointSaved] = useState(false);

  // Antigravity bridge endpoint & delivery target
  const [bridgeEndpoint, setBridgeEndpoint] = useState(DEFAULT_BRIDGE_ENDPOINT);
  const [bridgeSaved, setBridgeSaved] = useState(false);
  const [bridgeOnline, setBridgeOnline] = useState<boolean | null>(null);
  const [bridgeLoading, setBridgeLoading] = useState(false);
  const [conversations, setConversations] = useState<BridgeConversation[]>([]);
  const [projects, setProjects] = useState<BridgeProject[]>([]);
  const [defaultProjectId, setDefaultProjectId] = useState<string | null>(null);
  const [target, setTarget] = useState<BridgeTarget>({ mode: "existing" });
  const [note, setNote] = useState("");
  const [projectStatus, setProjectStatus] = useState<{
    kind: "idle" | "saving" | "saved" | "error";
    text?: string;
  }>({ kind: "idle" });
  const [submitStatus, setSubmitStatus] = useState<{
    kind: "idle" | "sending" | "sent" | "error";
    text?: string;
  }>({ kind: "idle" });

  const tabOrigin = state?.origin || "";

  useEffect(() => {
    chrome.storage.local.get(
      [STORAGE_KEY_ENDPOINT, STORAGE_KEY_BRIDGE_ENDPOINT],
      (data) => {
        const storedMcp = data[STORAGE_KEY_ENDPOINT];
        setEndpoint(
          typeof storedMcp === "string" ? storedMcp : DEFAULT_ENDPOINT,
        );
        const storedBridge = data[STORAGE_KEY_BRIDGE_ENDPOINT];
        setBridgeEndpoint(
          typeof storedBridge === "string"
            ? storedBridge
            : DEFAULT_BRIDGE_ENDPOINT,
        );
      },
    );
  }, []);

  useEffect(() => {
    if (!tabOrigin) return;
    chrome.storage.local.get(STORAGE_KEY_BRIDGE_TARGETS, (data) => {
      const map = data[STORAGE_KEY_BRIDGE_TARGETS] as
        | Record<string, BridgeTarget>
        | undefined;
      const saved = map?.[tabOrigin];
      if (saved && (saved.mode === "existing" || saved.mode === "new")) {
        setTarget(saved);
      } else {
        setTarget({ mode: "existing" });
      }
    });
  }, [tabOrigin]);

  const persistTarget = useCallback(
    (next: BridgeTarget) => {
      setTarget(next);
      if (!tabOrigin) return;
      chrome.storage.local.get(STORAGE_KEY_BRIDGE_TARGETS, (data) => {
        const existing =
          (data[STORAGE_KEY_BRIDGE_TARGETS] as
            | Record<string, BridgeTarget>
            | undefined) || {};
        chrome.storage.local.set({
          [STORAGE_KEY_BRIDGE_TARGETS]: {
            ...existing,
            [tabOrigin]: next,
          },
        });
      });
    },
    [tabOrigin],
  );

  const loadBridgeData = useCallback(async (url: string) => {
    const normalized = url.trim().replace(/\/+$/, "");
    if (!normalized) {
      setBridgeOnline(false);
      setConversations([]);
      setProjects([]);
      setDefaultProjectId(null);
      return;
    }
    setBridgeLoading(true);
    try {
      const data = await fetchBridgeConversations(normalized);
      setBridgeOnline(true);
      setConversations(data.conversations || []);
      setProjects(data.projects || []);
      setDefaultProjectId(data.defaultProjectId || null);
    } catch {
      setBridgeOnline(false);
    } finally {
      setBridgeLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadBridgeData(bridgeEndpoint);
  }, [bridgeEndpoint, loadBridgeData]);

  const showSaved = () => {
    setEndpointSaved(true);
    setTimeout(() => setEndpointSaved(false), 1500);
  };

  const saveEndpoint = () => {
    const normalized = endpoint.trim().replace(/\/+$/, "");
    chrome.storage.local.set({ [STORAGE_KEY_ENDPOINT]: normalized });
    setEndpoint(normalized);
    showSaved();
  };

  const resetEndpoint = () => {
    chrome.storage.local.set({ [STORAGE_KEY_ENDPOINT]: DEFAULT_ENDPOINT });
    setEndpoint(DEFAULT_ENDPOINT);
    showSaved();
  };

  const showBridgeSaved = () => {
    setBridgeSaved(true);
    setTimeout(() => setBridgeSaved(false), 1500);
  };

  const saveBridgeEndpoint = () => {
    const normalized = bridgeEndpoint.trim().replace(/\/+$/, "");
    chrome.storage.local.set({ [STORAGE_KEY_BRIDGE_ENDPOINT]: normalized });
    setBridgeEndpoint(normalized);
    showBridgeSaved();
    void loadBridgeData(normalized);
  };

  const resetBridgeEndpoint = () => {
    chrome.storage.local.set({
      [STORAGE_KEY_BRIDGE_ENDPOINT]: DEFAULT_BRIDGE_ENDPOINT,
    });
    setBridgeEndpoint(DEFAULT_BRIDGE_ENDPOINT);
    showBridgeSaved();
    void loadBridgeData(DEFAULT_BRIDGE_ENDPOINT);
  };

  const refreshState = () => {
    sendToTab<StateResponse>({ type: "GET_STATE" }, (response) => {
      if (response) setState(response);
    });
  };

  useEffect(() => {
    refreshState();
  }, []);

  const toggleToolbar = () => {
    sendToTab({ type: "TOGGLE_TOOLBAR" }, () => refreshState());
  };

  const copyMarkdown = () => {
    sendToTab({ type: "COPY_MARKDOWN" }, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const clearAnnotations = () => {
    sendToTab({ type: "CLEAR_ANNOTATIONS" }, () => refreshState());
  };

  const submitAntigravity = () => {
    if (submitStatus.kind === "sending") return;
    setSubmitStatus({ kind: "sending" });
    sendToTab<SubmitResult>(
      {
        type: "SUBMIT_TO_ANTIGRAVITY",
        note: note.trim() || undefined,
      },
      (res) => {
        if (res?.ok) {
          setNote("");
          setSubmitStatus({
            kind: "sent",
            text:
              res.mode === "new"
                ? "Sent to new Antigravity chat!"
                : "Sent to Antigravity!",
          });
          setTimeout(() => setSubmitStatus({ kind: "idle" }), 2500);
        } else {
          setSubmitStatus({
            kind: "error",
            text: res?.error || "Failed to send to Antigravity.",
          });
        }
      },
    );
  };

  const active = state?.active ?? false;
  const count = state?.annotationCount ?? 0;
  const bridgeConfigured = bridgeEndpoint.trim() !== "";

  const formatProjectFolder = (folderUri?: string | null): string | undefined => {
    if (!folderUri) return undefined;
    return folderUri.startsWith("file://")
      ? folderUri.slice("file://".length)
      : folderUri;
  };

  const filteredConversations =
    target.mode === "existing" && target.projectId
      ? conversations.filter((c) => c.projectId === target.projectId)
      : conversations;

  const selectedNewProjectId =
    target.projectId && projects.some((p) => p.id === target.projectId)
      ? target.projectId
      : defaultProjectId && projects.some((p) => p.id === defaultProjectId)
        ? defaultProjectId
        : "";

  const matchedProject = selectedNewProjectId
    ? projects.find((p) => p.id === selectedNewProjectId)
    : undefined;

  const hasSavedMissingConv =
    target.mode === "existing" &&
    !!target.conversationId &&
    !filteredConversations.some(
      (c) => c.conversationId === target.conversationId,
    );

  const handleExistingProjectChange = (projectId: string) => {
    const project = projects.find((p) => p.id === projectId);
    const projectName =
      projectId === "outside-of-project"
        ? "Outside of Project"
        : project?.name;
    const projectFolder = formatProjectFolder(project?.folderUri);

    const selectedConv = conversations.find(
      (c) => c.conversationId === target.conversationId,
    );
    const keepConv =
      !projectId || (selectedConv && selectedConv.projectId === projectId);

    persistTarget({
      ...target,
      mode: "existing",
      projectId: projectId || undefined,
      projectName,
      projectFolder,
      conversationId: keepConv ? target.conversationId : undefined,
      conversationTitle: keepConv ? target.conversationTitle : undefined,
    });
  };

  const handleNewProjectChange = async (projectId: string) => {
    if (!projectId) {
      persistTarget({
        ...target,
        mode: "new",
        projectId: undefined,
        projectName: undefined,
        projectFolder: undefined,
      });
      return;
    }

    const project = projects.find((p) => p.id === projectId);
    const nextTarget: BridgeTarget = {
      ...target,
      mode: "new",
      projectId,
      projectName: project?.name,
      projectFolder: formatProjectFolder(project?.folderUri),
    };
    persistTarget(nextTarget);

    setProjectStatus({ kind: "saving" });
    const res = await setBridgeProject(bridgeEndpoint, projectId);
    if (res.ok) {
      setDefaultProjectId(res.defaultProjectId || projectId);
      setProjectStatus({ kind: "saved", text: "Project bound" });
      setTimeout(() => setProjectStatus({ kind: "idle" }), 1800);
    } else {
      setProjectStatus({
        kind: "error",
        text: res.error || "Failed to bind project",
      });
    }
  };

  const canSubmit =
    state !== null &&
    count > 0 &&
    bridgeConfigured &&
    (target.mode === "new" || !!target.conversationId) &&
    submitStatus.kind !== "sending";

  return (
    <div class="popup">
      <div class="popup-header">
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#6366F1"
          stroke-width="2"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
        </svg>
        <h1>Agentation</h1>
      </div>

      {state === null ? (
        <div class="popup-status">
          <div class="popup-status-dot inactive" />
          <span>Not available on this page</span>
        </div>
      ) : (
        <>
          <div class="popup-status">
            <div class={`popup-status-dot ${active ? "" : "inactive"}`} />
            <span>{active ? "Toolbar active" : "Toolbar hidden"}</span>
          </div>

          <div class="popup-actions">
            <button class="popup-btn" onClick={toggleToolbar}>
              {active ? "Hide toolbar" : "Show toolbar"}
            </button>

            {count > 0 && (
              <>
                <button class="popup-btn" onClick={copyMarkdown}>
                  {copied ? "Copied!" : "Copy as markdown"}
                </button>
                <button
                  class="popup-btn popup-btn-danger"
                  onClick={clearAnnotations}
                >
                  Clear all annotations
                </button>
              </>
            )}
          </div>

          <div class="popup-count">
            {count === 0
              ? "No annotations on this page"
              : `${count} annotation${count !== 1 ? "s" : ""}`}
          </div>
        </>
      )}

      {/* ── Antigravity Bridge ── */}
      <div class="popup-section">
        <div class="popup-section-header">
          <div class="popup-section-title">
            <span
              class={`popup-status-dot ${bridgeOnline ? "online" : "inactive"}`}
              title={
                bridgeOnline
                  ? "Antigravity Bridge connected"
                  : "Antigravity Bridge offline"
              }
            />
            <span>Antigravity Bridge</span>
          </div>
          <button
            class="popup-link-btn"
            onClick={() => void loadBridgeData(bridgeEndpoint)}
            disabled={bridgeLoading || !bridgeConfigured}
          >
            {bridgeLoading ? "Loading…" : "Refresh"}
          </button>
        </div>

        <div class="popup-segmented">
          <button
            class={`popup-seg-btn ${target.mode === "existing" ? "active" : ""}`}
            onClick={() =>
              persistTarget({
                ...target,
                mode: "existing",
              })
            }
          >
            Existing Chat
          </button>
          <button
            class={`popup-seg-btn ${target.mode === "new" ? "active" : ""}`}
            onClick={() =>
              persistTarget({
                ...target,
                mode: "new",
              })
            }
          >
            New Chat
          </button>
        </div>

        <div class="popup-field">
          <label class="popup-field-label" htmlFor="agentation-project-select">
            <span>Project</span>
            {target.mode === "new" && projectStatus.kind !== "idle" && (
              <span
                class={`popup-field-status ${projectStatus.kind === "error" ? "error" : ""}`}
              >
                {projectStatus.kind === "saving"
                  ? "Binding…"
                  : projectStatus.text}
              </span>
            )}
          </label>

          {target.mode === "existing" ? (
            <select
              id="agentation-project-select"
              class="popup-select"
              value={target.projectId || ""}
              disabled={!bridgeConfigured || !bridgeOnline}
              onChange={(e) =>
                handleExistingProjectChange(
                  (e.target as HTMLSelectElement).value,
                )
              }
            >
              <option value="">All Projects</option>
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
              <option value="outside-of-project">Outside of Project</option>
            </select>
          ) : (
            <select
              id="agentation-project-select"
              class="popup-select"
              value={selectedNewProjectId}
              disabled={!bridgeConfigured || projects.length === 0}
              onChange={(e) =>
                void handleNewProjectChange(
                  (e.target as HTMLSelectElement).value,
                )
              }
            >
              <option value="">
                {bridgeOnline === false
                  ? "Bridge offline"
                  : projects.length === 0
                    ? "No projects found"
                    : "Select project…"}
              </option>
              {projects.map((proj) => (
                <option key={proj.id} value={proj.id}>
                  {proj.name}
                </option>
              ))}
            </select>
          )}
        </div>

        {target.mode === "existing" ? (
          <select
            class="popup-select"
            value={target.conversationId || ""}
            disabled={
              !bridgeConfigured ||
              (filteredConversations.length === 0 && !hasSavedMissingConv)
            }
            onChange={(e) => {
              const id = (e.target as HTMLSelectElement).value;
              const conv = conversations.find((c) => c.conversationId === id);
              persistTarget({
                ...target,
                mode: "existing",
                conversationId: id || undefined,
                conversationTitle: conv?.title || target.conversationTitle,
              });
            }}
          >
            <option value="">
              {bridgeOnline === false
                ? "Bridge offline — enable Agentation Bridge sidecar"
                : filteredConversations.length === 0
                  ? target.projectId
                    ? "No chats in selected project"
                    : "No active Antigravity chats found"
                  : "Select target conversation…"}
            </option>
            {hasSavedMissingConv && (
              <option value={target.conversationId}>
                {truncate(target.conversationTitle || target.conversationId!)}
              </option>
            )}
            {filteredConversations.map((conv) => (
              <option key={conv.conversationId} value={conv.conversationId}>
                {!target.projectId && conv.projectName
                  ? `${truncate(conv.title, 26)} · ${conv.projectName}`
                  : truncate(conv.title, 38)}
              </option>
            ))}
          </select>
        ) : (
          <p class="popup-endpoint-hint">
            {matchedProject
              ? `New chats open in: ${matchedProject.name}`
              : defaultProjectId
                ? `Default sidecar project: ${defaultProjectId}`
                : "Choose a project above for New Chat mode."}
          </p>
        )}

        <input
          class="popup-endpoint-input"
          type="text"
          value={note}
          placeholder="Optional note for Antigravity…"
          onInput={(e) => setNote((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && canSubmit) submitAntigravity();
          }}
        />

        <button
          class="popup-btn popup-btn-primary"
          disabled={!canSubmit}
          onClick={submitAntigravity}
        >
          {submitStatus.kind === "sending"
            ? "Sending to Antigravity…"
            : submitStatus.kind === "sent"
              ? "Sent!"
              : "Submit to Antigravity"}
        </button>

        {submitStatus.kind !== "idle" && submitStatus.text && (
          <p
            class={`popup-feedback ${submitStatus.kind === "error" ? "error" : "success"}`}
          >
            {submitStatus.text}
          </p>
        )}
      </div>

      {/* ── Endpoints ── */}
      <div class="popup-endpoint">
        <label class="popup-endpoint-label" htmlFor="agentation-bridge-endpoint">
          Bridge Endpoint
          {bridgeSaved && <span class="popup-endpoint-saved">Saved</span>}
        </label>
        <input
          id="agentation-bridge-endpoint"
          class="popup-endpoint-input"
          type="text"
          value={bridgeEndpoint}
          placeholder={DEFAULT_BRIDGE_ENDPOINT}
          onInput={(e) =>
            setBridgeEndpoint((e.target as HTMLInputElement).value)
          }
          onKeyDown={(e) => {
            if (e.key === "Enter") saveBridgeEndpoint();
          }}
        />
        <div class="popup-endpoint-actions">
          <button
            class="popup-btn popup-btn-small"
            onClick={saveBridgeEndpoint}
          >
            Save
          </button>
          <button
            class="popup-btn popup-btn-small"
            onClick={resetBridgeEndpoint}
          >
            Reset
          </button>
        </div>

        <label
          class="popup-endpoint-label"
          htmlFor="agentation-endpoint"
          style={{ marginTop: 6 }}
        >
          MCP Endpoint
          {endpointSaved && <span class="popup-endpoint-saved">Saved</span>}
        </label>
        <input
          id="agentation-endpoint"
          class="popup-endpoint-input"
          type="text"
          value={endpoint}
          placeholder="http://localhost:4747"
          onInput={(e) => setEndpoint((e.target as HTMLInputElement).value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") saveEndpoint();
          }}
        />
        <div class="popup-endpoint-actions">
          <button class="popup-btn popup-btn-small" onClick={saveEndpoint}>
            Save
          </button>
          <button class="popup-btn popup-btn-small" onClick={resetEndpoint}>
            Reset
          </button>
        </div>
        <p class="popup-endpoint-hint">
          {endpoint.trim() === ""
            ? "Empty — local-only mode, annotations stay in this browser."
            : `Annotations sync to ${endpoint} for MCP resolve/SSE.`}
        </p>
      </div>
    </div>
  );
}

render(<Popup />, document.getElementById("app")!);
