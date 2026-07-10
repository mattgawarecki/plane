/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

/**
 * Hosts we consider "local". Anything else is refused — this tool only ever
 * runs against a LOCAL Plane instance. There is deliberately no flag to disable
 * this check; it runs at config load AND before every request (defense in depth).
 */
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

/**
 * Throw unless `base` points at a local host. Pure and total: an unparseable
 * URL throws too. Called from config load and re-asserted per request.
 */
export const assertLocalhost = (base: string): void => {
  let host: string;
  try {
    // strip IPv6 brackets: new URL("http://[::1]").hostname === "[::1]"
    host = new URL(base).hostname.replace(/^\[|\]$/g, "");
  } catch {
    throw new Error(`Refusing to run: "${base}" is not a valid URL.`);
  }
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(
      `Refusing to run against non-local host "${host}". ` +
        `This demo tool only targets a LOCAL Plane instance (localhost / 127.0.0.1 / ::1 / 0.0.0.0).`
    );
  }
};
