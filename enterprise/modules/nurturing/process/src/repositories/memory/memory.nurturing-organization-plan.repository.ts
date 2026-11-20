// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type NurturingPlanFact,
  type NurturingPlanHeld,
  planFactChangesCopy,
} from "../../rules/nurturing-organization-plan.rules.ts";
import type { NurturingOrganizationPlanRepository } from "../nurturing-organization-plan.repository.ts";

/** The Postgres twin's semantics: a fact lands only where it changes the copy. */
export class MemoryNurturingOrganizationPlanRepository implements NurturingOrganizationPlanRepository {
  static create(): MemoryNurturingOrganizationPlanRepository {
    return new MemoryNurturingOrganizationPlanRepository();
  }

  readonly #plans = new Map<string, NurturingPlanFact>();

  private constructor() {}

  async findPlan({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingPlanHeld> {
    const fact = this.#plans.get(organizationId);
    return fact ? { outcome: "held", fact } : { outcome: "none" };
  }

  async recordPlan({
    organizationId,
    fact,
  }: Readonly<{ organizationId: string; fact: NurturingPlanFact }>): Promise<void> {
    const held = await this.findPlan({ organizationId });
    if (planFactChangesCopy({ held, incoming: fact })) this.#plans.set(organizationId, fact);
  }
}
