// =============================================================================
// Antigravity Sidecar Bridge Client
// =============================================================================
//
// Communicates with the local agentation-bridge Antigravity Sidecar via the
// extension background worker (proxyFetch) so host-page CSP never interferes.

import { proxyFetch } from "./sync";

export type BridgeConversation = {
  conversationId: string;
  title: string;
  projectId: string;
  projectName: string | null;
  workspaceUris: string;
  status: string;
  lastModifiedTime: string;
};

export type BridgeProject = {
  id: string;
  name: string;
  folderUri: string | null;
};

export type BridgeHealthResponse = {
  ok: boolean;
  service: string;
  port: number;
  defaultProjectId: string | null;
};

export type BridgeConversationsResponse = {
  ok: boolean;
  conversations: BridgeConversation[];
  projects: BridgeProject[];
  defaultProjectId: string | null;
};

export type BridgeSubmitPayload = {
  mode: "existing" | "new";
  projectId?: string;
  projectName?: string;
  projectFolder?: string;
  conversationId?: string;
  url?: string;
  pathname?: string;
  sessionId?: string | null;
  output: string;
  annotations?: Array<{
    id: string;
    comment?: string;
    element?: string;
    elementPath?: string;
  }>;
  note?: string;
};

export type BridgeSetProjectResponse = {
  ok: boolean;
  defaultProjectId?: string;
  project?: BridgeProject;
  error?: string;
};

export type BridgeSubmitResponse = {
  ok: boolean;
  mode?: "existing" | "new";
  conversationId?: string | null;
  stdout?: string;
  error?: string;
  stderr?: string;
};

function normalize(endpoint: string): string {
  return endpoint.trim().replace(/\/+$/, "");
}

export async function checkBridgeHealth(
  endpoint: string,
): Promise<BridgeHealthResponse | null> {
  const base = normalize(endpoint);
  if (!base) return null;
  try {
    const res = await proxyFetch(`${base}/health`);
    if (!res.ok || !res.body || typeof res.body !== "object") return null;
    return res.body as BridgeHealthResponse;
  } catch {
    return null;
  }
}

export async function fetchBridgeConversations(
  endpoint: string,
): Promise<BridgeConversationsResponse> {
  const base = normalize(endpoint);
  const res = await proxyFetch(`${base}/conversations`);
  if (!res.ok || !res.body || typeof res.body !== "object") {
    throw new Error(`Bridge unavailable (${res.status || "offline"})`);
  }
  return res.body as BridgeConversationsResponse;
}

export async function setBridgeProject(
  endpoint: string,
  projectId: string,
): Promise<BridgeSetProjectResponse> {
  const base = normalize(endpoint);
  const res = await proxyFetch(`${base}/project`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });

  const body =
    res.body && typeof res.body === "object"
      ? (res.body as BridgeSetProjectResponse)
      : null;

  if (!res.ok || !body?.ok) {
    return {
      ok: false,
      error: body?.error || `Failed to set project (${res.status || "offline"})`,
    };
  }

  return body;
}

export async function submitToAntigravity(
  endpoint: string,
  payload: BridgeSubmitPayload,
): Promise<BridgeSubmitResponse> {
  const base = normalize(endpoint);
  const res = await proxyFetch(`${base}/submit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });

  const body =
    res.body && typeof res.body === "object"
      ? (res.body as BridgeSubmitResponse)
      : null;

  if (!res.ok || !body?.ok) {
    return {
      ok: false,
      error: body?.error || `Bridge request failed (${res.status || "offline"})`,
      stderr: body?.stderr,
    };
  }

  return body;
}
