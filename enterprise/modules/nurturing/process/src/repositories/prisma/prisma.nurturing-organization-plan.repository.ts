// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { PrismaRepository } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type {
  NurturingPlanFact,
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
      VALUES (${organizationId}, ${plan}, ${occurredAt}::timestamp(3), ${fromCatchUp})
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
