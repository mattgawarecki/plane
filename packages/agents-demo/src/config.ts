/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { assertLocalhost } from "./guardrail";

/** Resolved, validated configuration for the demo tooling. */
export type DemoConfig = {
  /** Plane REST base, e.g. http://localhost:8000 (localhost-guarded). */
  base: string;
  /** Plane personal API token, sent as the `X-Api-Key` header. */
  token: string;
  /** Workspace slug the tool operates in. */
  workspace: string;
  /** Project the tool writes to. Optional here; write ops require it. */
  projectId?: string | undefined;
  /** Anthropic key for the LLM runtime (unused by the Plane client). */
  anthropicKey?: string | undefined;
};

/** Accept a plain record so tests can pass a fake environment. */
type Env = Record<string, string | undefined>;

/**
 * Build a DemoConfig from environment variables. Runs the localhost guardrail
 * on the resolved base and hard-fails when no token is present.
 */
export const loadConfig = (env: Env = process.env): DemoConfig => {
  const base = env.PLANE_API_BASE ?? "http://localhost:8000";
  assertLocalhost(base); // refuse non-local before anything else

  const token = env.PLANE_API_KEY ?? env.PLANE_API_TOKEN;
  if (!token) {
    throw new Error(
      "Missing Plane API token. Set PLANE_API_KEY (or PLANE_API_TOKEN) in .env.demo — " +
        "create a personal API token in Plane under Profile → API tokens."
    );
  }

  return {
    base,
    token,
    workspace: env.PLANE_WORKSPACE ?? "klarity",
    projectId: env.PLANE_PROJECT_ID,
    anthropicKey: env.ANTHROPIC_API_KEY,
  };
};
