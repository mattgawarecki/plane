/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Demo bridge: exposes the runtime's run journal + commands over HTTP so the
 * web Agents panel can show live runs. Polling-based (the panel refetches
 * listRuns); SSE streaming is the noted upgrade. LOCAL demo only.
 *   PLANE_PROJECT_ID=<id> pnpm --filter @plane/agents-demo exec tsx src/server.ts
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { applyEvent, reconcile, emptyAgentState } from "@plane/agents";
import type { TAgentCollectionState, TAgentEvent, TAgentRun, TAgentRunStatus } from "@plane/agents";
import { loadConfig } from "./config";
import { PlaneClient } from "./client/plane-client";
import { PlaneResources } from "./client/resources";
import { dispatch } from "./runtime/dispatch";

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

const PORT = Number(process.env.PLANE_AGENTS_PORT ?? 4000);
const now = () => new Date().toISOString();

// --- server-owned run state (source of truth for the panel) ---
let state: TAgentCollectionState = emptyAgentState();
const pendingByRun = new Map<string, (ok: boolean) => void>(); // one pending approval per run
const runById = () => Object.values(state.runs);

const seedRun = (run: TAgentRun) => {
  state = reconcile(state, [run]);
};
const applyServerEvent = (event: TAgentEvent) => {
  state = applyEvent(state, event);
};
const setStatus = (runId: string, status: TAgentRunStatus) => {
  const run = state.runs[runId];
  if (run) state = { ...state, runs: { ...state.runs, [runId]: { ...run, status } } };
};

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  loadEnvFile(resolve(repoRoot, ".env.demo"));
  const cfg = loadConfig();
  const client = new PlaneClient({ base: cfg.base, token: cfg.token });

  // Resolve the demo project (self-sufficient if PLANE_PROJECT_ID is unset).
  const wsRes = new PlaneResources(client, cfg.workspace);
  const project = cfg.projectId ? { id: cfg.projectId } : await wsRes.ensureProject("Agent Demo", "ADEMO");
  const resources = new PlaneResources(client, cfg.workspace, project.id);
  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  function startDispatch(request: string): string {
    let runId = "";
    void dispatch(
      {
        anthropic,
        resources,
        workspaceId: cfg.workspace,
        now,
        onRunStart: (run) => {
          runId = run.id;
          seedRun(run);
        },
        emit: applyServerEvent,
        requestApproval: (req) =>
          new Promise<boolean>((res) => {
            pendingByRun.set(runId, res);
            void req;
          }),
      },
      request
    ).catch((err) => {
      console.error("dispatch failed", err);
      if (runId) setStatus(runId, "failed");
      pendingByRun.delete(runId);
    });
    return runId; // may be "" until onRunStart fires (next tick) — the panel polls
  }

  const server = createServer((req, res) => handle(req, res, cfg.workspace, startDispatch));
  server.listen(PORT, () => {
    console.log(`▷ agents bridge on http://localhost:${PORT}  (workspace ${cfg.workspace}, project ${project.id})`);
    console.log(`  trigger a run:  curl -s localhost:${PORT}/dispatch -d '{"request":"What is in flight?"}'`);
  });
}

// --- HTTP ---
function cors(req: IncomingMessage, res: ServerResponse) {
  res.setHeader("Access-Control-Allow-Origin", req.headers.origin ?? "*");
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Api-Key, Authorization");
}
const json = (res: ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
};
const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((done) => {
    let b = "";
    req.on("data", (c) => (b += c));
    req.on("end", () => done(b));
  });

async function handle(
  req: IncomingMessage,
  res: ServerResponse,
  workspace: string,
  startDispatch: (r: string) => string
) {
  cors(req, res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }
  const url = new URL(req.url ?? "/", "http://localhost");
  const parts = url.pathname.split("/").filter(Boolean);
  const base = `/api/workspaces/${workspace}/agent-runs`;

  // GET .../agent-runs/
  if (req.method === "GET" && url.pathname === `${base}/`) {
    return json(res, 200, { runs: runById() });
  }
  // GET .../agent-runs/:id/
  if (req.method === "GET" && parts.length === 5 && url.pathname.startsWith(`${base}/`)) {
    const run = state.runs[parts[4]!];
    return run ? json(res, 200, run) : json(res, 404, { error: "not found" });
  }
  // POST .../agent-runs/:id/commands/
  if (req.method === "POST" && url.pathname === `${base}/${parts[4]}/commands/` && parts[5] === "commands") {
    const runId = parts[4]!;
    const body = JSON.parse((await readBody(req)) || "{}") as { type?: string };
    switch (body.type) {
      case "approve":
      case "reject":
        pendingByRun.get(runId)?.(body.type === "approve");
        pendingByRun.delete(runId);
        break;
      case "pause":
        setStatus(runId, "paused");
        break;
      case "resume":
        setStatus(runId, "running");
        break;
      case "cancel":
        pendingByRun.get(runId)?.(false);
        pendingByRun.delete(runId);
        setStatus(runId, "cancelled");
        break;
      default:
        break;
    }
    return json(res, 200, { ok: true });
  }
  // POST /dispatch  { request }
  if (req.method === "POST" && url.pathname === "/dispatch") {
    const body = JSON.parse((await readBody(req)) || "{}") as { request?: string };
    if (!body.request) return json(res, 400, { error: "missing request" });
    const runId = startDispatch(body.request);
    return json(res, 202, { runId });
  }
  if (url.pathname === "/health") return json(res, 200, { ok: true });
  return json(res, 404, { error: "not found" });
}

void main();
