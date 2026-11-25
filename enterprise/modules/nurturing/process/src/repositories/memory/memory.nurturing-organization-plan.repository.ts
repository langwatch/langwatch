// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import type {
  NurturingPlanFact,
  NurturingPlanFoldState,
} from "../../rules/nurturing-organization-plan.rules.ts";
import type { NurturingOrganizationPlanRepository } from "../nurturing-organization-plan.repository.ts";

/** One row as the Postgres table holds it. */
type PlanRow = Readonly<{
  fact: NurturingPlanFact;
  appliedEventIds: readonly string[];
  winnerEventId: string | null;
}>;

/** The Postgres twin's semantics: the fold's store replaces the organization's row. */
export class MemoryNurturingOrganizationPlanRepository implements NurturingOrganizationPlanRepository {
  static create(): MemoryNurturingOrganizationPlanRepository {
    return new MemoryNurturingOrganizationPlanRepository();
  }

  readonly #rows = new Map<string, PlanRow>();

  private constructor() {}

  async get(organizationId: string): Promise<FoldStateRead<NurturingPlanFoldState>> {
    const { state } = await this.getWithApplied(organizationId);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  async getWithApplied(organizationId: string): Promise<{
    state: NurturingPlanFoldState | null;
    appliedEventIds: string[];
    miss?: "absent";
  }> {
    const row = this.#rows.get(organizationId);
    if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
    return {
      state: {
        held: { outcome: "held", fact: row.fact },
        winnerEventId: row.winnerEventId,
        LastEventOccurredAt: row.fact.occurredAt,
      },
      appliedEventIds: [...row.appliedEventIds],
    };
  }

  async store(state: NurturingPlanFoldState, context: ProjectionStoreContext): Promise<void> {
    if (state.held.outcome === "none") return;
    this.#rows.set(context.key ?? context.aggregateId, {
      fact: state.held.fact,
      appliedEventIds: [...(context.appliedEventIds ?? [])],
      winnerEventId: state.winnerEventId,
    });
  }
}
