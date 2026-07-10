/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Pure: whether a live subscription should be open. Kept in its own import-light
 * module so it (and its test) don't pull in the store/React. The socket opens
 * ONLY when the flag is on AND there's something to watch — so flag-off or an
 * idle panel means zero connections.
 */
export const shouldSubscribe = (p: { enabled: boolean; hasWatchTargets: boolean }): boolean =>
  p.enabled && p.hasWatchTargets;
