// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";

import {
  type NurturingPlanFact,
  type NurturingPlanFoldState,
  type NurturingPlanHeld,
  planFactChangesCopy,
} from "../../rules/nurturing-organization-plan.rules.ts";
import type { NurturingOrganizationPlanRepository } from "../nurturing-organization-plan.repository.ts";

/** One row as the Postgres table holds it. */
type PlanRow = Readonly<{
  fact: NurturingPlanFact;
  appliedEventIds: readonly string[];
  winnerEventId: string | null;
}>;

/**
 * The Postgres twin's semantics: a fact recorded lands only where it changes the copy; the fold's
 * store replaces the row.
 */
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

  async findPlan({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingPlanHeld> {
    const row = this.#rows.get(organizationId);
    return row ? { outcome: "held", fact: row.fact } : { outcome: "none" };
  }

  async recordPlan({
    organizationId,
    fact,
  }: Readonly<{ organizationId: string; fact: NurturingPlanFact }>): Promise<void> {
    const held = await this.findPlan({ organizationId });
    if (!planFactChangesCopy({ held, incoming: fact })) return;
    const known = this.#rows.get(organizationId);
    this.#rows.set(organizationId, {
      fact,
      appliedEventIds: known?.appliedEventIds ?? [],
      winnerEventId: known?.winnerEventId ?? null,
    });
  }
}
