/**
 * Copyright (c) 2023-present Plane Software, Inc. and contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import type { PlaneClient } from "./plane-client";

/** Plane list endpoints return a paginated `{ results: [...] }`; some return a bare array. */
const asList = <T>(res: unknown): T[] =>
  Array.isArray(res) ? (res as T[]) : ((res as { results?: T[] })?.results ?? []);

export type TStateGroup = "backlog" | "unstarted" | "started" | "completed" | "cancelled";

export type TPlaneState = { id: string; name: string; group: TStateGroup };
export type TPlaneMember = { member_id: string; member__display_name?: string };
export type TWorkItem = { id: string; name: string; sequence_id?: number };

export type TCreateWorkItem = {
  name: string;
  description_html?: string | undefined;
  state?: string | undefined;
  parent?: string | undefined;
  assignees?: string[] | undefined;
  labels?: string[] | undefined;
  priority?: "urgent" | "high" | "medium" | "low" | "none" | undefined;
  start_date?: string | undefined;
  target_date?: string | undefined;
};

/**
 * Typed surface over the Plane endpoints the demo needs, mapped 1:1 to the
 * verified REST routes. Project-scoped writes require a projectId.
 */
export class PlaneResources {
  constructor(
    private readonly c: PlaneClient,
    private readonly workspace: string,
    private readonly projectId?: string
  ) {}

  private proj(): string {
    if (!this.projectId) throw new Error("No PLANE_PROJECT_ID set — required for project-scoped writes.");
    return this.projectId;
  }
  private ws(): string {
    return this.workspace;
  }

  // ---- projects ----
  async listProjects(): Promise<{ id: string; name: string; identifier: string }[]> {
    return asList(await this.c.get(`/workspaces/${this.ws()}/projects/`));
  }
  createProject(name: string, identifier: string): Promise<{ id: string; name: string; identifier: string }> {
    return this.c.post(`/workspaces/${this.ws()}/projects/`, { name, identifier });
  }
  /** Return the project with this identifier, creating it if absent. */
  async ensureProject(name: string, identifier: string): Promise<{ id: string; name: string; identifier: string }> {
    const existing = (await this.listProjects()).find((p) => p.identifier === identifier);
    return existing ?? this.createProject(name, identifier);
  }

  // ---- read ----
  /** Enumerate the project's work items, enriched with state name/group + priority. */
  async listWorkItems(): Promise<
    {
      id: string;
      name: string;
      sequence_id?: number | undefined;
      priority?: string | undefined;
      stateName?: string | undefined;
      stateGroup?: TStateGroup | undefined;
    }[]
  > {
    const [raw, states] = await Promise.all([
      this.c.get(`/workspaces/${this.ws()}/projects/${this.proj()}/work-items/`),
      this.listStates(),
    ]);
    const byId = new Map(states.map((s) => [s.id, s]));
    const items = asList<{ id: string; name: string; sequence_id?: number; priority?: string; state?: string }>(raw);
    return items.map((i) => {
      const st = i.state ? byId.get(i.state) : undefined;
      return {
        id: i.id,
        name: i.name,
        sequence_id: i.sequence_id,
        priority: i.priority,
        stateName: st?.name,
        stateGroup: st?.group,
      };
    });
  }

  async searchWorkItems(query: string): Promise<TWorkItem[]> {
    // The search endpoint returns { issues: [...] }, not a bare array.
    const res = await this.c.get<{ issues?: TWorkItem[] }>(
      `/workspaces/${this.ws()}/work-items/search/?search=${encodeURIComponent(query)}`
    );
    return res.issues ?? [];
  }
  // async so a missing-projectId guard surfaces as a rejection, not a sync throw
  async listStates(): Promise<TPlaneState[]> {
    return asList(await this.c.get(`/workspaces/${this.ws()}/projects/${this.proj()}/states/`));
  }
  async resolveStateByGroup(group: TStateGroup): Promise<TPlaneState | undefined> {
    const states = await this.listStates();
    return states.find((s) => s.group === group);
  }
  async listMembers(): Promise<TPlaneMember[]> {
    return asList(await this.c.get(`/workspaces/${this.ws()}/projects/${this.proj()}/members/`));
  }

  // ---- write ----
  async createWorkItem(fields: TCreateWorkItem): Promise<TWorkItem> {
    return this.c.post(`/workspaces/${this.ws()}/projects/${this.proj()}/work-items/`, fields);
  }
  /** A sub-issue is just a create with `parent` set — no separate endpoint. */
  async createSubIssue(parentId: string, fields: Omit<TCreateWorkItem, "parent">): Promise<TWorkItem> {
    return this.createWorkItem({ ...fields, parent: parentId });
  }
  async updateWorkItem(id: string, patch: Partial<TCreateWorkItem>): Promise<TWorkItem> {
    return this.c.patch(`/workspaces/${this.ws()}/projects/${this.proj()}/work-items/${id}/`, patch);
  }
  async addComment(id: string, commentHtml: string): Promise<{ id: string }> {
    return this.c.post(`/workspaces/${this.ws()}/projects/${this.proj()}/work-items/${id}/comments/`, {
      comment_html: commentHtml,
    });
  }
}
