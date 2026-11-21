// =============================================================================
// Server Sync Utilities
// =============================================================================
//
// Optional server synchronization for the Agentation protocol.
// When an endpoint is provided, annotations sync to a server.
// Falls back gracefully to local-only mode on network errors.
//
// All requests go through the background service worker (PROXY_FETCH) so that
// host-page CSP (connect-src / https) never blocks the local MCP endpoint.

import type { Annotation, Session, SessionWithAnnotations } from "../shared/types";
import type { ProxyFetchMessage, ProxyFetchResponse } from "../shared/messages";

type ProxyFetchOptions = ProxyFetchMessage["options"];

function normalize(endpoint: string): string {
  return endpoint.replace(/\/+$/, "");
}

export async function proxyFetch(
  url: string,
  options?: ProxyFetchOptions,
): Promise<ProxyFetchResponse> {
  const message: ProxyFetchMessage = { type: "PROXY_FETCH", url, options };
  const response = await chrome.runtime.sendMessage<
    ProxyFetchMessage,
    ProxyFetchResponse
  >(message);
  if (!response) {
    throw new Error("No response from background worker");
  }
  return response;
}

/**
 * Health check against the server. Returns true when the server responds 2xx.
 */
export async function checkHealth(endpoint: string): Promise<boolean> {
  try {
    const response = await proxyFetch(`${normalize(endpoint)}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * List all sessions from the server.
 */
export async function listSessions(endpoint: string): Promise<Session[]> {
  const response = await proxyFetch(`${normalize(endpoint)}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.status}`);
  }
  return response.body as Session[];
}

/**
 * Create a new session on the server.
 */
export async function createSession(
  endpoint: string,
  url: string
): Promise<Session> {
  const response = await proxyFetch(`${normalize(endpoint)}/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });

  if (!response.ok) {
    throw new Error(`Failed to create session: ${response.status}`);
  }

  return response.body as Session;
}

/**
 * Get an existing session with its annotations.
 */
export async function getSession(
  endpoint: string,
  sessionId: string
): Promise<SessionWithAnnotations> {
  const response = await proxyFetch(
    `${normalize(endpoint)}/sessions/${sessionId}`,
  );

  if (!response.ok) {
    throw new Error(`Failed to get session: ${response.status}`);
  }

  return response.body as SessionWithAnnotations;
}

/**
 * Sync a new annotation to the server.
 * Returns the annotation with any server-assigned fields.
 */
export async function syncAnnotation(
  endpoint: string,
  sessionId: string,
  annotation: Annotation
): Promise<Annotation> {
  const response = await proxyFetch(
    `${normalize(endpoint)}/sessions/${sessionId}/annotations`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(annotation),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to sync annotation: ${response.status}`);
  }

  return response.body as Annotation;
}

/**
 * Update an annotation on the server.
 */
export async function updateAnnotation(
  endpoint: string,
  annotationId: string,
  data: Partial<Annotation>
): Promise<Annotation> {
  const response = await proxyFetch(
    `${normalize(endpoint)}/annotations/${annotationId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to update annotation: ${response.status}`);
  }

  return response.body as Annotation;
}

/**
 * Delete an annotation from the server.
 */
export async function deleteAnnotation(
  endpoint: string,
  annotationId: string
): Promise<void> {
  const response = await proxyFetch(
    `${normalize(endpoint)}/annotations/${annotationId}`,
    { method: "DELETE" },
  );

  if (!response.ok) {
    throw new Error(`Failed to delete annotation: ${response.status}`);
  }
}

export type ActionResponse = {
  success: boolean;
  annotationCount: number;
  delivered: {
    sseListeners: number;
    webhooks: number;
    total: number;
  };
};

/**
 * Request the agent to act on annotations.
 * Emits an action.requested event via SSE to notify connected agents.
 * Returns delivery info so the UI can show accurate feedback.
 */
export async function requestAction(
  endpoint: string,
  sessionId: string,
  output: string
): Promise<ActionResponse> {
  const response = await proxyFetch(
    `${normalize(endpoint)}/sessions/${sessionId}/action`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ output }),
    },
  );

  if (!response.ok) {
    throw new Error(`Failed to request action: ${response.status}`);
  }

  return response.body as ActionResponse;
}
