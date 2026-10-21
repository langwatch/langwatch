// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingCodingMilestonesRepository,
  NurturingMilestonesRepository,
  NurturingOrganizationCounts,
  NurturingOrganizationRow,
} from "../nurturing-milestones.repository.ts";

/** The Postgres twin's semantics over nurturing's own organizations. */
export class MemoryNurturingMilestonesRepository
  implements NurturingMilestonesRepository, NurturingCodingMilestonesRepository
{
  readonly #organizations = new Map<string, NurturingOrganizationRow>();

  static create(): MemoryNurturingMilestonesRepository {
    return new MemoryNurturingMilestonesRepository();
  }

  async recordOrganization({
    organizationId,
    adminUserId,
    seeded,
  }: Parameters<NurturingMilestonesRepository["recordOrganization"]>[0]): Promise<void> {
    const known = this.#organizations.get(organizationId);
    this.#organizations.set(
      organizationId,
      known
        ? { ...known, adminUserId: adminUserId ?? known.adminUserId }
        : {
            organizationId,
            adminUserId,
            seeded,
            evaluationCount: 0,
            simulationRunCount: 0,
            codingFirstSessionAt: null,
            codingAgentTypes: [],
            codingActiveDays: 0,
            codingLastActiveDay: null,
          },
    );
  }

  async countEvaluation({
    organizationId,
    by,
  }: Readonly<{ organizationId: string; by: number }>): Promise<NurturingOrganizationCounts[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    const counted = { ...organization, evaluationCount: organization.evaluationCount + by };
    this.#organizations.set(organizationId, counted);
    return [counted];
  }

  async countSimulationRun({
    organizationId,
    by,
  }: Readonly<{ organizationId: string; by: number }>): Promise<NurturingOrganizationCounts[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    const counted = { ...organization, simulationRunCount: organization.simulationRunCount + by };
    this.#organizations.set(organizationId, counted);
    return [counted];
  }

  async findOrganization({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationRow[]> {
    const organization = this.#organizations.get(organizationId);
    return organization ? [organization] : [];
  }

  async recordCodingFirstSession({
    organizationId,
    occurredAt,
  }: Parameters<NurturingCodingMilestonesRepository["recordCodingFirstSession"]>[0]): Promise<{
    first: boolean;
  }> {
    const organization = this.#organizations.get(organizationId);
    if (!organization || organization.codingFirstSessionAt !== null) return { first: false };
    this.#organizations.set(organizationId, { ...organization, codingFirstSessionAt: occurredAt });
    return { first: true };
  }

  async addCodingAgentType({
    organizationId,
    agentType,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingAgentType"]>[0]): Promise<{
    changed: boolean;
    codingAgentTypes: string[];
  }> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return { changed: false, codingAgentTypes: [] };
    if (organization.codingAgentTypes.includes(agentType)) {
      return { changed: false, codingAgentTypes: [...organization.codingAgentTypes] };
    }
    const codingAgentTypes = [...organization.codingAgentTypes, agentType];
    this.#organizations.set(organizationId, { ...organization, codingAgentTypes });
    return { changed: true, codingAgentTypes: [...codingAgentTypes] };
  }

  async recordCodingActiveDay({
    organizationId,
    day,
  }: Parameters<NurturingCodingMilestonesRepository["recordCodingActiveDay"]>[0]): Promise<{
    changed: boolean;
    codingActiveDays: number;
  }> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return { changed: false, codingActiveDays: 0 };
    const last = organization.codingLastActiveDay;
    if (last !== null && last >= day) {
      return { changed: false, codingActiveDays: organization.codingActiveDays };
    }
    const codingActiveDays = organization.codingActiveDays + 1;
    this.#organizations.set(organizationId, {
      ...organization,
      codingActiveDays,
      codingLastActiveDay: day,
    });
    return { changed: true, codingActiveDays };
  }
}
