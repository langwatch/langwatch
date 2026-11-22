// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import {
  ScimSsoConnectionReadRepository,
  type ScimSsoConnectionFoldState,
  type ScimSsoConnectionRepository,
} from "../scim-sso-connection.repository.ts";

/** SCIM's folded connections in memory: the peer fold's store and the read over it. */
export class MemoryScimSsoConnectionRepository
  extends ScimSsoConnectionReadRepository
  implements ScimSsoConnectionRepository
{
  static create(): MemoryScimSsoConnectionRepository {
    return new MemoryScimSsoConnectionRepository();
  }

  private readonly rows = new Map<
    string,
    { state: ScimSsoConnectionFoldState; appliedEventIds: string[] }
  >();

  private constructor() {
    super();
  }

  async get(aggregateId: string): Promise<FoldStateRead<ScimSsoConnectionFoldState>> {
    const row = this.rows.get(aggregateId);
    return row ? { kind: "folded", state: row.state } : { kind: "empty" };
  }

  async getWithApplied(aggregateId: string): Promise<{
    state: ScimSsoConnectionFoldState | null;
    appliedEventIds: string[];
    miss?: "absent";
  }> {
    const row = this.rows.get(aggregateId);
    return row
      ? { state: row.state, appliedEventIds: [...row.appliedEventIds] }
      : { state: null, appliedEventIds: [], miss: "absent" };
  }

  async store(state: ScimSsoConnectionFoldState, context: ProjectionStoreContext): Promise<void> {
    this.rows.set(context.aggregateId, {
      state,
      appliedEventIds: [...(context.appliedEventIds ?? [])],
    });
  }

  async findForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<ScimSsoConnectionFoldState[]> {
    return [...this.rows.values()]
      .map(({ state }) => state)
      .filter((state) => state.organizationId === organizationId)
      .toSorted((a, b) => b.createdAtMs - a.createdAtMs);
  }
}
