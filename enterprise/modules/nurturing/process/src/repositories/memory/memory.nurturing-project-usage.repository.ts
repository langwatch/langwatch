// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  FoldProjectionStore,
  FoldStateRead,
  ProjectionStoreContext,
} from "@langwatch/eventing";

import type { NurturingProjectUsageState } from "../../rules/nurturing-project-usage.rules.ts";
import {
  type NurturingProjectUsageOwner,
  type NurturingProjectUsageRepository,
  projectUsageRowId,
} from "../nurturing-project-usage.repository.ts";

type Row = { state: NurturingProjectUsageState; appliedEventIds: string[] };

/** Nurturing's project-usage rows in memory: one fold store per owner and the reads over them. */
export class MemoryNurturingProjectUsageRepository implements NurturingProjectUsageRepository {
  static create(): MemoryNurturingProjectUsageRepository {
    return new MemoryNurturingProjectUsageRepository();
  }

  readonly #rows = new Map<string, Row>();
  readonly #placements = new Map<string, string>();

  private constructor() {}

  forOwner(owner: NurturingProjectUsageOwner): FoldProjectionStore<NurturingProjectUsageState> {
    const rows = this.#rows;
    return {
      async get(key: string): Promise<FoldStateRead<NurturingProjectUsageState>> {
        const row = rows.get(projectUsageRowId(owner, key));
        return row ? { kind: "folded", state: row.state } : { kind: "empty" };
      },
      async getWithApplied(key: string) {
        const row = rows.get(projectUsageRowId(owner, key));
        return row
          ? { state: row.state, appliedEventIds: [...row.appliedEventIds] }
          : { state: null, appliedEventIds: [], miss: "absent" as const };
      },
      async store(state: NurturingProjectUsageState, context: ProjectionStoreContext) {
        rows.set(projectUsageRowId(owner, context.key ?? context.aggregateId), {
          state,
          appliedEventIds: [...(context.appliedEventIds ?? [])],
        });
      },
    };
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
    return [...this.#rows.values()]
      .map(({ state }) => state)
      .filter((state) => this.#placements.get(state.projectId) === organizationId);
  }
}
