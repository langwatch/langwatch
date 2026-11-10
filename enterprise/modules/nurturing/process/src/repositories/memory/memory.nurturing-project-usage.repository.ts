// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import type { NurturingProjectUsageState } from "../../rules/nurturing-project-usage.rules.ts";
import type { NurturingProjectUsageRepository } from "../nurturing-project-usage.repository.ts";

type Row = { state: NurturingProjectUsageState; appliedEventIds: string[] };

/** Nurturing's project-usage rows in memory: the peer fold's store and the reads over it. */
export class MemoryNurturingProjectUsageRepository implements NurturingProjectUsageRepository {
  static create(): MemoryNurturingProjectUsageRepository {
    return new MemoryNurturingProjectUsageRepository();
  }

  readonly #rows = new Map<string, Row>();
  readonly #placements = new Map<string, string>();

  private constructor() {}

  async get(aggregateId: string): Promise<FoldStateRead<NurturingProjectUsageState>> {
    const row = this.#rows.get(aggregateId);
    return row ? { kind: "folded", state: row.state } : { kind: "empty" };
  }

  async getWithApplied(aggregateId: string): Promise<{
    state: NurturingProjectUsageState | null;
    appliedEventIds: string[];
    miss?: "absent";
  }> {
    const row = this.#rows.get(aggregateId);
    return row
      ? { state: row.state, appliedEventIds: [...row.appliedEventIds] }
      : { state: null, appliedEventIds: [], miss: "absent" };
  }

  async store(state: NurturingProjectUsageState, context: ProjectionStoreContext): Promise<void> {
    this.#rows.set(context.aggregateId, {
      state,
      appliedEventIds: [...(context.appliedEventIds ?? [])],
    });
  }

  async placeProject({
    projectId,
    organizationId,
  }: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    this.#placements.set(projectId, organizationId);
  }

  async findForOrganization({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingProjectUsageState[]> {
    return [...this.#rows.entries()]
      .filter(([projectId]) => this.#placements.get(projectId) === organizationId)
      .map(([, { state }]) => state);
  }
}
