/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { assertLocalhost } from "../guardrail";

export type THttpMethod = "GET" | "POST" | "PATCH" | "DELETE";

/** Minimal fetch signature so tests can inject a fake. */
export type TFetch = (url: string, init: RequestInit) => Promise<Response>;

export type PlaneClientOptions = {
  base: string;
  token: string;
  /** When true, writes are logged + skipped (return a synthetic id). */
  dryRun?: boolean;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: TFetch;
  /** Sink for dry-run notices; defaults to console.log. */
  log?: (msg: string) => void;
};

/**
 * Thin token-authenticated client for Plane's public REST API (`/api/v1`).
 * Injects `X-Api-Key`, re-asserts the localhost guardrail on every call, and
 * no-ops writes under dry-run.
 */
export class PlaneClient {
  private readonly fetchImpl: TFetch;
  private readonly log: (msg: string) => void;

  constructor(private readonly opts: PlaneClientOptions) {
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as TFetch);
    this.log = opts.log ?? ((m) => console.log(m));
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>("GET", path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("POST", path, body);
  }
  patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>("PATCH", path, body);
  }
  del<T>(path: string): Promise<T> {
    return this.request<T>("DELETE", path);
  }

  async request<T>(method: THttpMethod, path: string, body?: unknown): Promise<T> {
    assertLocalhost(this.opts.base); // defense in depth — every call

    if (this.opts.dryRun && method !== "GET") {
      const syntheticId = `dry_${crypto.randomUUID()}`;
      this.log(`[dry-run] ${method} ${path} ${body ? JSON.stringify(body) : ""} → ${syntheticId}`);
      return { id: syntheticId } as T;
    }

    const url = `${this.opts.base}/api/v1${path}`;
    const init: RequestInit = {
      method,
      headers: {
        "X-Api-Key": this.opts.token,
        "Content-Type": "application/json",
      },
    };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await this.fetchImpl(url, init);

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`Plane API ${method} ${path} failed: ${res.status} ${text}`.trim());
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }
}
