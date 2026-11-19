// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { NurturingPlanFoldState } from "../../rules/nurturing-organization-plan.rules.ts";
import type { NurturingOrganizationPlanRepository } from "../nurturing-organization-plan.repository.ts";

type NurturingOrganizationPlanDatabase = Pick<PrismaClient, "nurturingOrganizationPlan">;

/** Nurturing's own `NurturingOrganizationPlan` rows, folded from billing's subscription facts. */
export class PrismaNurturingOrganizationPlanRepository
  extends PrismaRepository.for("NurturingOrganizationPlan")
  implements NurturingOrganizationPlanRepository
{
  static create({
    prisma,
  }: Readonly<{
    prisma: NurturingOrganizationPlanDatabase;
  }>): PrismaNurturingOrganizationPlanRepository {
    return new PrismaNurturingOrganizationPlanRepository(prisma);
  }

  readonly #database: NurturingOrganizationPlanDatabase;

  private constructor(prisma: NurturingOrganizationPlanDatabase) {
    super(prisma);
    this.#database = prisma;
  }

  async get(organizationId: string): Promise<FoldStateRead<NurturingPlanFoldState>> {
    const { state } = await this.getWithApplied(organizationId);
    return state ? { kind: "folded", state } : { kind: "empty" };
  }

  /** The row has no version to refuse, so a miss is only ever an absent row. */
  async getWithApplied(organizationId: string): Promise<{
    state: NurturingPlanFoldState | null;
    appliedEventIds: string[];
    miss?: "absent";
  }> {
    const row = await this.#database.nurturingOrganizationPlan.findUnique({
      where: { organizationId },
    });
    if (!row) return { state: null, appliedEventIds: [], miss: "absent" };
    const occurredAt = row.occurredAt.getTime();
    return {
      state: {
        held: {
          outcome: "held",
          fact: { plan: row.plan, occurredAt, fromCatchUp: row.fromCatchUp },
        },
        winnerEventId: row.winnerEventId,
        LastEventOccurredAt: occurredAt,
      },
      appliedEventIds: row.appliedEventIds,
    };
  }

  /**
   * Replaces the organization's row with the fold's state and the ids folded in; the executor
   * serializes an organization's folds, so the last store is the fold's. A state holding no fact
   * has no row to write: the fold stores only after folding one, so it never comes here.
   */
  async store(state: NurturingPlanFoldState, context: ProjectionStoreContext): Promise<void> {
    if (state.held.outcome === "none") return;
    const organizationId = context.key ?? context.aggregateId;
    const { plan, occurredAt, fromCatchUp } = state.held.fact;
    const columns = {
      plan,
      occurredAt: new Date(occurredAt),
      fromCatchUp,
      appliedEventIds: [...(context.appliedEventIds ?? [])],
      winnerEventId: state.winnerEventId,
    };
    await this.#database.nurturingOrganizationPlan.upsert({
      where: { organizationId },
      create: { organizationId, ...columns },
      update: columns,
    });
  }
}
