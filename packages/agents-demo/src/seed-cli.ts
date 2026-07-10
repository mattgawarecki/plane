/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 *
 * Seeds a LOCAL Plane workspace with a plausible demo project so the agent has
 * real content to Ask about, an epic to Delegate against, and stale items to
 * gate-close. Idempotent: skips if the epic already exists.
 *   pnpm --filter @plane/agents-demo exec tsx src/seed-cli.ts
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { loadConfig } from "./config";
import { PlaneClient } from "./client/plane-client";
import { PlaneResources, type TStateGroup } from "./client/resources";

function loadEnvFile(path: string): void {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    if (process.env[m[1]!] === undefined) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

const EPIC = "September billing close";

type Seed = { name: string; group: TStateGroup; priority?: "urgent" | "high" | "medium" | "low" | "none" };

const IN_FLIGHT: Seed[] = [
  { name: "Fix cold-start crash on stale offline cache", group: "started", priority: "high" },
  { name: "Reconcile September invoices against ledger", group: "started", priority: "high" },
  { name: "Investigate duplicate signup webhooks", group: "started", priority: "urgent" },
  { name: "Add rate limiting to the public API", group: "unstarted", priority: "medium" },
  { name: "Rewrite the onboarding email sequence", group: "unstarted", priority: "low" },
];

// Stale August-close items — the set the agent will offer to bulk-close.
const STALE: Seed[] = [
  { name: "August close: reconcile invoices", group: "started" },
  { name: "August close: chase unpaid accounts", group: "started" },
  { name: "August close: verify tax lines", group: "unstarted" },
  { name: "August close: archive working docs", group: "unstarted" },
];

async function main() {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
  loadEnvFile(resolve(repoRoot, ".env.demo"));
  const cfg = loadConfig();
  const client = new PlaneClient({ base: cfg.base, token: cfg.token });

  // 1. ensure the demo project
  const wsRes = new PlaneResources(client, cfg.workspace);
  const project = await wsRes.ensureProject("Agent Demo", "ADEMO");
  console.log(`▷ project: ${project.name} (${project.identifier}) ${project.id}`);

  const res = new PlaneResources(client, cfg.workspace, project.id);

  // 2. idempotency — skip if the epic already exists
  const existing = await res.searchWorkItems(EPIC);
  if (existing.some((i) => i.name === EPIC)) {
    console.log("• already seeded — nothing to do. (delete the Agent Demo project to re-seed)");
    console.log(
      `\nRun the agent against it with:\n  PLANE_PROJECT_ID=${project.id} pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts "<request>"`
    );
    return;
  }

  // 3. resolve the state ids we need, by group
  const groups: TStateGroup[] = ["backlog", "started", "unstarted"];
  const resolved = await Promise.all(groups.map((g) => res.resolveStateByGroup(g)));
  const stateByGroup: Partial<Record<TStateGroup, string>> = {};
  groups.forEach((g, i) => {
    const s = resolved[i];
    if (s) stateByGroup[g] = s.id;
  });

  // 4. epic (left empty — Delegate fills it live on stage)
  const epic = await res.createWorkItem({
    name: EPIC,
    description_html: "<p>Monthly finance close. Hand this to an agent to decompose.</p>",
    priority: "high",
    state: stateByGroup.backlog,
  });
  console.log(`✓ epic: ${epic.name}`);

  // 5. in-flight + stale items
  const created = await Promise.all(
    [...IN_FLIGHT, ...STALE].map((it) =>
      res.createWorkItem({ name: it.name, priority: it.priority, state: stateByGroup[it.group] })
    )
  );
  console.log(`✓ created ${created.length} work items (${IN_FLIGHT.length} in-flight, ${STALE.length} stale)`);

  console.log(
    `\nRun the agent against it with:\n  PLANE_PROJECT_ID=${project.id} pnpm --filter @plane/agents-demo exec tsx src/dispatch-cli.ts "<request>"`
  );
}

void main();
