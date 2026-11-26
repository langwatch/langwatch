// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingErasedUserRepository } from "../nurturing-erased-user.repository.ts";
import {
  MAX_CODING_REPOSITORY_KEYS,
  type NurturingCodingMilestonesRepository,
  type NurturingMilestonesRepository,
  type NurturingOrganizationAdminRepository,
  type NurturingOrganizationCounts,
  type NurturingOrganizationRow,
  type NurturingTraceMilestonesRepository,
} from "../nurturing-milestones.repository.ts";
import { MemoryNurturingErasedUserRepository } from "./memory.nurturing-erased-user.repository.ts";

/** A row plus the columns only their own writes read, as the Postgres table holds them. */
type MemoryOrganization = NurturingOrganizationRow &
  Readonly<{
    codingTerminalTypes: string[];
    codingRepositoryKeys: string[];
    codingFirstDays: number[];
  }>;

/** A row as Postgres creates it: every column at its default. */
function newOrganization(organizationId: string): MemoryOrganization {
  return {
    organizationId,
    adminUserId: null,
    seeded: false,
    evaluationCount: 0,
    simulationRunCount: 0,
    codingFirstSessionAt: null,
    codingAgentTypes: [],
    codingActiveDays: 0,
    codingLastActiveDay: null,
    codingTerminalTypes: [],
    codingRepositoryKeys: [],
    codingFirstDays: [],
  };
}

/** The greater id, as GREATEST under `COLLATE "C"` compares ids (ASCII); null when both are. */
function pickGreaterId(known: string | null, incoming: string | null): string | null {
  if (known === null) return incoming;
  if (incoming === null) return known;
  return incoming > known ? incoming : known;
}

/** The Postgres twin's semantics over nurturing's own organizations. */
export class MemoryNurturingMilestonesRepository
  implements
    NurturingMilestonesRepository,
    NurturingCodingMilestonesRepository,
    NurturingTraceMilestonesRepository,
    NurturingOrganizationAdminRepository
{
  readonly #organizations = new Map<string, MemoryOrganization>();
  readonly #lastTraceAt = new Map<string, number>();
  /** The `adminAt` column: the stamp of the fact that named the row's admin. */
  readonly #adminAt = new Map<string, number>();

  /** `erasedUsers` is the marks every memory copy of one composition shares. */
  static create({
    erasedUsers = MemoryNurturingErasedUserRepository.create(),
  }: Readonly<{
    erasedUsers?: NurturingErasedUserRepository;
  }> = {}): MemoryNurturingMilestonesRepository {
    return new MemoryNurturingMilestonesRepository(erasedUsers);
  }

  readonly #erasedUsers: NurturingErasedUserRepository;

  private constructor(erasedUsers: NurturingErasedUserRepository) {
    this.#erasedUsers = erasedUsers;
  }

  async recordLastTrace({
    organizationId,
    occurredAt,
  }: Readonly<{ organizationId: string; occurredAt: number }>): Promise<void> {
    if (!this.#organizations.has(organizationId)) {
      this.#organizations.set(organizationId, newOrganization(organizationId));
    }
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
        : { ...newOrganization(organizationId), adminUserId, seeded },
    );
  }

  /**
   * As the Postgres upsert and its re-check fold it. The mark is read before the row, so no other
   * write lands between the read of the row and its write.
   */
  async recordAdminFact({
    organizationId,
    adminUserId,
    at,
    seeded,
  }: Parameters<NurturingOrganizationAdminRepository["recordAdminFact"]>[0]): Promise<void> {
    const [erased] =
      adminUserId === null ? [] : await this.#erasedUsers.findErased({ userIds: [adminUserId] });
    const named = erased ? null : adminUserId;
    const known = this.#organizations.get(organizationId) ?? newOrganization(organizationId);
    const knownAt = this.#adminAt.get(organizationId);
    let admin = known.adminUserId;
    if (adminUserId !== null && (knownAt === undefined || at >= knownAt)) {
      admin = knownAt === at ? pickGreaterId(known.adminUserId, named) : named;
      this.#adminAt.set(organizationId, at);
    }
    // As the re-check does: a marked admin the row already named at this stamp goes.
    if (erased && admin === adminUserId) admin = null;
    this.#organizations.set(organizationId, {
      ...known,
      adminUserId: admin,
      seeded: known.seeded || seeded,
    });
  }

  async forgetAdmin({ adminUserId }: Readonly<{ adminUserId: string }>): Promise<void> {
    await this.#erasedUsers.markErased({ userId: adminUserId });
    for (const [organizationId, organization] of this.#organizations) {
      if (organization.adminUserId === adminUserId) {
        this.#organizations.set(organizationId, { ...organization, adminUserId: null });
      }
    }
  }

  async countEvaluation({
    organizationId,
    by,
  }: Readonly<{ organizationId: string; by: number }>): Promise<NurturingOrganizationCounts[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    const counted = { ...organization, evaluationCount: organization.evaluationCount + by };
    this.#organizations.set(organizationId, counted);
    return [await this.#unlessErased(counted)];
  }

  async countSimulationRun({
    organizationId,
    by,
  }: Readonly<{ organizationId: string; by: number }>): Promise<NurturingOrganizationCounts[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    const counted = { ...organization, simulationRunCount: organization.simulationRunCount + by };
    this.#organizations.set(organizationId, counted);
    return [await this.#unlessErased(counted)];
  }

  async findOrganization({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationRow[]> {
    const organization = this.#organizations.get(organizationId);
    return organization ? [await this.#unlessErased(organization)] : [];
  }

  /** As the Postgres twin: a marked admin reads as none. */
  async #unlessErased<Row extends NurturingOrganizationCounts>(organization: Row): Promise<Row> {
    const { adminUserId } = organization;
    if (adminUserId === null) return organization;
    const [erased] = await this.#erasedUsers.findErased({ userIds: [adminUserId] });
    return erased ? { ...organization, adminUserId: null } : organization;
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
