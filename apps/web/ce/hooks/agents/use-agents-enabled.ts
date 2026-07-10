/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Feature flag for the whole agents surface. CE has no runtime flag service, so
 * this is a build/env constant (default OFF) — EE can override this module via
 * the `@/plane-web` alias with a real flag hook. Evaluated BEFORE any socket or
 * poll opens, so flag-off means zero network footprint.
 */
export const useAgentsEnabled = (): boolean => import.meta.env.VITE_ENABLE_AGENTS === "1";
