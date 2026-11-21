import { createServer } from "node:http";
import { execFile as execFileCb } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFile = promisify(execFileCb);

const HOST = "127.0.0.1";
const PORT = Number(process.env.AGENTATION_BRIDGE_PORT || 4748);
const GEMINI_DIR = join(homedir(), ".gemini");
const CONFIG_DIR = join(GEMINI_DIR, "config");
const PROJECTS_DIR = join(CONFIG_DIR, "projects");
const CONFIG_FILE = join(CONFIG_DIR, "config.json");
const SUMMARIES_DB = join(GEMINI_DIR, "antigravity", "conversation_summaries.db");

function isAllowedOrigin(origin) {
  if (!origin) return true;
  try {
    const parsed = new URL(origin);
    if (parsed.protocol === "chrome-extension:") return true;
    if (
      parsed.protocol === "http:" &&
      (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1")
    ) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

function sendJson(res, status, data, origin) {
  const headers = {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  };
  if (origin && isAllowedOrigin(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }
  res.writeHead(status, headers);
  res.end(JSON.stringify(data));
}

function readJsonBody(req, maxBytes = 2 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on("data", (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error("Invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function loadDefaultProjectId() {
  try {
    if (!existsSync(CONFIG_FILE)) return null;
    const config = JSON.parse(readFileSync(CONFIG_FILE, "utf8"));
    const projectId = config?.sidecars?.["agentation-bridge"]?.projectId;
    return typeof projectId === "string" && projectId.trim()
      ? projectId.trim()
      : null;
  } catch {
    return null;
  }
}

function saveDefaultProjectId(projectId) {
  const projects = loadProjects();
  const matched = projects.find((p) => p.id === projectId);
  if (!matched) {
    throw new Error("Unknown or invalid projectId");
  }
  const config = existsSync(CONFIG_FILE)
    ? JSON.parse(readFileSync(CONFIG_FILE, "utf8"))
    : {};
  if (!config.sidecars || typeof config.sidecars !== "object") {
    config.sidecars = {};
  }
  const existingEntry =
    config.sidecars["agentation-bridge"] &&
    typeof config.sidecars["agentation-bridge"] === "object"
      ? config.sidecars["agentation-bridge"]
      : {};
  config.sidecars["agentation-bridge"] = {
    ...existingEntry,
    enabled: existingEntry.enabled ?? true,
    projectId,
  };
  writeFileSync(CONFIG_FILE, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return matched;
}

function loadProjects() {
  if (!existsSync(PROJECTS_DIR)) return [];
  const projects = [];
  for (const entry of readdirSync(PROJECTS_DIR)) {
    if (!entry.endsWith(".json")) continue;
    try {
      const raw = JSON.parse(readFileSync(join(PROJECTS_DIR, entry), "utf8"));
      if (raw?.sidecar || !raw?.id) continue;
      const resources = raw?.projectResources?.resources;
      const folderUri = Array.isArray(resources)
        ? resources.find((r) => r?.gitFolder?.folderUri)?.gitFolder?.folderUri ||
          resources.find((r) => r?.workspaceFolder?.folderUri)?.workspaceFolder
            ?.folderUri ||
          null
        : null;
      projects.push({
        id: String(raw.id),
        name: String(raw.name || raw.id),
        folderUri,
      });
    } catch {
      // Skip malformed project file
    }
  }
  projects.sort((a, b) => a.name.localeCompare(b.name));
  return projects;
}

async function loadConversations(limit = 80, projects = loadProjects()) {
  if (!existsSync(SUMMARIES_DB)) return [];
  const safeLimit = Math.max(1, Math.min(100, Number(limit) || 80));
  const projectMap = new Map(projects.map((p) => [p.id, p.name]));
  const query = `SELECT conversation_id, title, project_id, workspace_uris, status, last_modified_time FROM conversation_summaries WHERE nesting_depth = 0 AND killed = 0 AND source != 'sidecar' ORDER BY last_modified_time DESC LIMIT ${safeLimit};`;

  try {
    const { stdout } = await execFile(
      "sqlite3",
      ["-readonly", "-json", SUMMARIES_DB, query],
      { encoding: "utf8", timeout: 5000, maxBuffer: 4 * 1024 * 1024 },
    );
    const rows = JSON.parse(stdout || "[]");
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => ({
      conversationId: String(row.conversation_id || ""),
      title: String(row.title || "(Untitled)"),
      projectId: String(row.project_id || ""),
      projectName: projectMap.get(row.project_id) || null,
      workspaceUris: String(row.workspace_uris || ""),
      status: String(row.status || ""),
      lastModifiedTime: String(row.last_modified_time || ""),
    }));
  } catch {
    return [];
  }
}

function buildPrompt(payload) {
  const parts = [];
  const location = payload.url || payload.pathname || "the active page";
  const headerLines = [
    `UI feedback annotations submitted from Agentation browser extension for ${location}:`,
  ];
  if (
    payload.mode === "new" &&
    typeof payload.projectName === "string" &&
    payload.projectName.trim()
  ) {
    const folder =
      typeof payload.projectFolder === "string" && payload.projectFolder.trim()
        ? ` (${payload.projectFolder.trim()})`
        : "";
    headerLines.push(`Target project: ${payload.projectName.trim()}${folder}`);
  }
  parts.push(headerLines.join("\n"));

  if (typeof payload.note === "string" && payload.note.trim()) {
    parts.push(`### Additional Note\n\n${payload.note.trim()}`);
  }

  parts.push(payload.output.trim());

  const hasSession =
    typeof payload.sessionId === "string" && payload.sessionId.trim() !== "";
  const annotations = Array.isArray(payload.annotations)
    ? payload.annotations.filter((a) => a && typeof a.id === "string")
    : [];

  if (hasSession || annotations.length > 0) {
    const syncLines = ["### Agentation MCP Sync"];
    if (hasSession) {
      syncLines.push(`- sessionId: \`${payload.sessionId.trim()}\``);
    }
    if (annotations.length > 0) {
      syncLines.push("- Annotation IDs:");
      for (const item of annotations) {
        const label = item.element ? `${item.element}` : "element";
        const comment =
          typeof item.comment === "string" && item.comment.trim()
            ? item.comment.trim()
            : "(no comment)";
        syncLines.push(`  - id: \`${item.id}\` — ${label}: ${comment}`);
      }
    }
    syncLines.push(
      "After addressing each annotation, call `agentation_resolve` with its `annotationId` and a short `summary` (or use `agentation_reply` / `agentation_dismiss` when appropriate) so the browser markers update automatically via SSE.",
    );
    parts.push(syncLines.join("\n"));
  }

  return parts.join("\n\n");
}

function getAgentApiCommand() {
  const exe = process.env.ANTIGRAVITY_AGENTAPI_EXE;
  const file = exe || "agentapi";
  const baseArgs = exe ? ["agentapi"] : [];
  return { file, baseArgs };
}

async function dispatchToAntigravity(mode, conversationId, prompt) {
  const { file, baseArgs } = getAgentApiCommand();
  const args =
    mode === "existing"
      ? [...baseArgs, "send-message", conversationId, prompt]
      : [...baseArgs, "new-conversation", "--", prompt];

  const { stdout } = await execFile(file, args, {
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 2 * 1024 * 1024,
  });
  return (stdout || "").trim();
}

const server = createServer(async (req, res) => {
  const origin = req.headers.origin;
  if (!isAllowedOrigin(origin)) {
    sendJson(res, 403, { ok: false, error: "Forbidden origin" }, undefined);
    return;
  }

  if (req.method === "OPTIONS") {
    const headers = {
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "600",
    };
    if (origin) {
      headers["Access-Control-Allow-Origin"] = origin;
      headers["Vary"] = "Origin";
    }
    res.writeHead(204, headers);
    res.end();
    return;
  }

  const reqUrl = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "GET" && reqUrl.pathname === "/health") {
    sendJson(
      res,
      200,
      {
        ok: true,
        service: "agentation-bridge",
        port: PORT,
        defaultProjectId: loadDefaultProjectId(),
      },
      origin,
    );
    return;
  }

  if (req.method === "GET" && reqUrl.pathname === "/conversations") {
    const limit = reqUrl.searchParams.get("limit") || "80";
    const projects = loadProjects();
    const conversations = await loadConversations(Number(limit), projects);
    sendJson(
      res,
      200,
      {
        ok: true,
        conversations,
        projects,
        defaultProjectId: loadDefaultProjectId(),
      },
      origin,
    );
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/project") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(
        res,
        400,
        { ok: false, error: err instanceof Error ? err.message : "Bad request" },
        origin,
      );
      return;
    }

    const projectId =
      typeof body?.projectId === "string" ? body.projectId.trim() : "";
    if (!projectId) {
      sendJson(
        res,
        400,
        { ok: false, error: "projectId must be a non-empty string" },
        origin,
      );
      return;
    }

    try {
      const matched = saveDefaultProjectId(projectId);
      sendJson(
        res,
        200,
        {
          ok: true,
          defaultProjectId: matched.id,
          project: matched,
        },
        origin,
      );
    } catch (err) {
      sendJson(
        res,
        400,
        {
          ok: false,
          error: err instanceof Error ? err.message : "Invalid projectId",
        },
        origin,
      );
    }
    return;
  }

  if (req.method === "POST" && reqUrl.pathname === "/submit") {
    let body;
    try {
      body = await readJsonBody(req);
    } catch (err) {
      sendJson(
        res,
        400,
        { ok: false, error: err instanceof Error ? err.message : "Bad request" },
        origin,
      );
      return;
    }

    const mode = body?.mode;
    const conversationId =
      typeof body?.conversationId === "string" ? body.conversationId.trim() : "";
    const output = typeof body?.output === "string" ? body.output : "";

    if (mode !== "existing" && mode !== "new") {
      sendJson(
        res,
        400,
        { ok: false, error: 'mode must be "existing" or "new"' },
        origin,
      );
      return;
    }

    if (!output.trim()) {
      sendJson(
        res,
        400,
        { ok: false, error: "output must be a non-empty string" },
        origin,
      );
      return;
    }

    if (mode === "existing" && !conversationId) {
      sendJson(
        res,
        400,
        { ok: false, error: "conversationId is required when mode is existing" },
        origin,
      );
      return;
    }

    const prompt = buildPrompt(body);

    try {
      const stdout = await dispatchToAntigravity(mode, conversationId, prompt);
      sendJson(
        res,
        200,
        {
          ok: true,
          mode,
          conversationId: mode === "existing" ? conversationId : null,
          stdout,
        },
        origin,
      );
    } catch (err) {
      const stderr =
        err && typeof err === "object" && "stderr" in err
          ? String(err.stderr || "").trim()
          : "";
      const defaultProjectId = loadDefaultProjectId();
      const hint =
        mode === "new" && !defaultProjectId
          ? ' Hint: set "projectId" under sidecars["agentation-bridge"] in ~/.gemini/config/config.json for new-conversation mode.'
          : "";
      sendJson(
        res,
        502,
        {
          ok: false,
          error: `${err instanceof Error ? err.message : "agentapi failed"}${hint}`,
          stderr,
        },
        origin,
      );
    }
    return;
  }

  sendJson(res, 404, { ok: false, error: "Not found" }, origin);
});

server.listen(PORT, HOST, () => {
  console.log(`[agentation-bridge] listening on http://${HOST}:${PORT}`);
});
