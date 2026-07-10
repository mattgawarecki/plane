/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Live spike entry: run one natural-language dispatch against the LOCAL Plane.
 *   pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts "what's in flight?"
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import Anthropic from "@anthropic-ai/sdk";
import type { TAgentEvent } from "@plane/agents";
import { loadConfig } from "./config";
import { PlaneClient } from "./client/plane-client";
import { PlaneResources } from "./client/resources";
import { dispatch } from "./runtime/dispatch";

/** Load KEY=VALUE lines from an env file into process.env (no dependency). */
function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return; // fine if already in the environment
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1]!;
    const val = m[2]!.replace(/^["']|["']$/g, "");
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** Human-readable console sink for the run's contract events. */
function printEvent(e: TAgentEvent): void {
  const glyphs: Record<string, string> = {
    step_started: "▸",
    step_completed: "✓",
    approval_requested: "⚑",
    completed: "◼",
    status_changed: "•",
  };
  const tag = glyphs[e.type] ?? "·";
  const detail =
    e.type === "step_started" || e.type === "step_completed"
      ? e.payload.label
      : e.type === "approval_requested"
        ? e.payload.summary
        : e.type === "status_changed"
          ? e.payload.status
          : e.type === "completed"
            ? "done"
            : "";
  console.log(`  ${tag} ${e.type}  ${detail}`);
}

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  loadEnvFile(resolve(repoRoot, ".env.demo"));

  const request = process.argv.slice(2).join(" ").trim();
  if (!request) {
    console.error('Usage: tsx src/dispatch-cli.ts "<your request>"');
    process.exit(1);
  }

  const cfg = loadConfig();
  const client = new PlaneClient({ base: cfg.base, token: cfg.token });
  const resources = new PlaneResources(client, cfg.workspace, cfg.projectId);
  const anthropic = new Anthropic({ apiKey: cfg.anthropicKey });

  // AGENT_APPROVE forces the decision (for scripted / rehearsed runs); otherwise
  // prompt an interactive TTY; with no TTY and no override, default to declined (safe).
  const forced = process.env.AGENT_APPROVE?.trim().toLowerCase();
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const requestApproval = async (req: { summary: string }): Promise<boolean> => {
    if (forced) {
      const ok = forced === "y" || forced === "yes" || forced === "1";
      console.log(`\n  ⚑ ${req.summary} → ${ok ? "APPROVED" : "REJECTED"} (AGENT_APPROVE=${forced})`);
      return ok;
    }
    if (!process.stdin.isTTY) {
      console.log(`\n  ⚑ ${req.summary} → declined (no TTY, no AGENT_APPROVE)`);
      return false;
    }
    const ans = (await rl.question(`\n  ⚑ APPROVE: ${req.summary}? [y/N] `)).trim().toLowerCase();
    return ans === "y" || ans === "yes";
  };

  console.log(`\n▷ dispatch: "${request}"\n`);
  try {
    const { answer } = await dispatch(
      { anthropic, resources, emit: printEvent, requestApproval, now: () => new Date().toISOString() },
      request
    );
    console.log(`\n■ answer:\n${answer}\n`);
  } finally {
    rl.close();
  }
}

void main();
