// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { FoldStateRead, ProjectionStoreContext } from "@langwatch/eventing";
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingPlanFact,
  NurturingPlanFoldState,
  NurturingPlanHeld,
} from "../../rules/nurturing-organization-plan.rules.ts";
import type { NurturingOrganizationPlanRepository } from "../nurturing-organization-plan.repository.ts";

type NurturingOrganizationPlanDatabase = Pick<
  PrismaClient,
  "nurturingOrganizationPlan" | "$executeRaw"
>;

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

  async findPlan({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingPlanHeld> {
    const row = await this.#database.nurturingOrganizationPlan.findUnique({
      where: { organizationId },
    });
    if (!row) return { outcome: "none" };
    return {
      outcome: "held",
      fact: {
        plan: row.plan,
        occurredAt: row.occurredAt.getTime(),
        fromCatchUp: row.fromCatchUp,
      },
    };
  }

  /** One statement whose WHERE is `planFactChangesCopy`, so two racing folds cannot both land. */
  async recordPlan({
    organizationId,
    fact,
  }: Readonly<{ organizationId: string; fact: NurturingPlanFact }>): Promise<void> {
    const { plan, fromCatchUp } = fact;
    const occurredAt = new Date(fact.occurredAt);
    await this.#database.$executeRaw`
      INSERT INTO "NurturingOrganizationPlan" AS known
        ("organizationId", "plan", "occurredAt", "fromCatchUp")
      VALUES (${organizationId}, ${plan}, (${occurredAt}::timestamptz AT TIME ZONE 'UTC')::timestamp(3),
              ${fromCatchUp})
      ON CONFLICT ("organizationId") DO UPDATE SET
        "plan" = EXCLUDED."plan",
        "occurredAt" = EXCLUDED."occurredAt",
        "fromCatchUp" = EXCLUDED."fromCatchUp"
      WHERE EXCLUDED."occurredAt" > known."occurredAt"
         OR (EXCLUDED."occurredAt" = known."occurredAt"
             AND known."fromCatchUp" AND NOT EXCLUDED."fromCatchUp")
    `;
  }
}
