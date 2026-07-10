/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/** Capped exponential backoff. Jitter is applied by the caller (kept pure/testable). */
export const backoffDelay = (attempt: number, opts: { base?: number; cap?: number } = {}): number => {
  const base = opts.base ?? 500;
  const cap = opts.cap ?? 30000;
  const n = Math.max(0, attempt);
  return Math.min(cap, base * 2 ** n);
};
