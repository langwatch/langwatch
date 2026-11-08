// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  MAX_CODING_REPOSITORY_KEYS,
  type NurturingCodingMilestonesRepository,
  type NurturingMilestonesRepository,
  type NurturingOrganizationCounts,
  type NurturingOrganizationRow,
  type NurturingTraceMilestonesRepository,
} from "../nurturing-milestones.repository.ts";

/** A row plus the columns only their own writes read, as the Postgres table holds them. */
type MemoryOrganization = NurturingOrganizationRow &
  Readonly<{
    codingTerminalTypes: string[];
    codingRepositoryKeys: string[];
    codingFirstDays: number[];
  }>;

/** The Postgres twin's semantics over nurturing's own organizations. */
export class MemoryNurturingMilestonesRepository
  implements
    NurturingMilestonesRepository,
    NurturingCodingMilestonesRepository,
    NurturingTraceMilestonesRepository
{
  readonly #organizations = new Map<string, MemoryOrganization>();
  readonly #lastTraceAt = new Map<string, number>();

  static create(): MemoryNurturingMilestonesRepository {
    return new MemoryNurturingMilestonesRepository();
  }

  async recordLastTrace({
    organizationId,
    occurredAt,
  }: Readonly<{ organizationId: string; occurredAt: number }>): Promise<void> {
    if (!this.#organizations.has(organizationId)) return;
    const known = this.#lastTraceAt.get(organizationId);
    if (known === undefined || known < occurredAt) {
      this.#lastTraceAt.set(organizationId, occurredAt);
    }
  }

  async findLastTraceAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<number | null> {
    return this.#lastTraceAt.get(organizationId) ?? null;
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
            codingTerminalTypes: [],
            codingRepositoryKeys: [],
            codingFirstDays: [],
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
    if (!organization) return { first: false };
    // A retry of the fact that set it answers first again, so a failed delivery is not lost.
    if (organization.codingFirstSessionAt !== null) {
      return { first: organization.codingFirstSessionAt === occurredAt };
    }
    this.#organizations.set(organizationId, { ...organization, codingFirstSessionAt: occurredAt });
    return { first: true };
  }

  async addCodingAgentType({
    organizationId,
    agentType,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingAgentType"]>[0]): Promise<string[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    if (organization.codingAgentTypes.includes(agentType)) {
      return [...organization.codingAgentTypes];
    }
    const codingAgentTypes = [...organization.codingAgentTypes, agentType];
    this.#organizations.set(organizationId, { ...organization, codingAgentTypes });
    return [...codingAgentTypes];
  }

  async addCodingTerminalType({
    organizationId,
    terminalType,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingTerminalType"]>[0]): Promise<
    string[]
  > {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    if (organization.codingTerminalTypes.includes(terminalType)) {
      return [...organization.codingTerminalTypes];
    }
    const codingTerminalTypes = [...organization.codingTerminalTypes, terminalType];
    this.#organizations.set(organizationId, { ...organization, codingTerminalTypes });
    return [...codingTerminalTypes];
  }

  async addCodingRepository({
    organizationId,
    repositoryKey,
  }: Parameters<NurturingCodingMilestonesRepository["addCodingRepository"]>[0]): Promise<number> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return 0;
    if (
      organization.codingRepositoryKeys.includes(repositoryKey) ||
      organization.codingRepositoryKeys.length >= MAX_CODING_REPOSITORY_KEYS
    ) {
      return organization.codingRepositoryKeys.length;
    }
    const codingRepositoryKeys = [...organization.codingRepositoryKeys, repositoryKey];
    this.#organizations.set(organizationId, { ...organization, codingRepositoryKeys });
    return codingRepositoryKeys.length;
  }

  async addCodingSessionDayOffset({
    organizationId,
    dayOffset,
  }: Parameters<
    NurturingCodingMilestonesRepository["addCodingSessionDayOffset"]
  >[0]): Promise<number> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return 0;
    if (organization.codingFirstDays.includes(dayOffset)) {
      return organization.codingFirstDays.length;
    }
    const codingFirstDays = [...organization.codingFirstDays, dayOffset];
    this.#organizations.set(organizationId, { ...organization, codingFirstDays });
    return codingFirstDays.length;
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
      // The day already counted answers changed again, so a failed delivery is not lost.
      return { changed: last === day, codingActiveDays: organization.codingActiveDays };
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
