// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMilestonesRepository,
  NurturingOrganizationCounts,
} from "../nurturing-milestones.repository.ts";

/** The Postgres twin's semantics over nurturing's own organizations. */
export class MemoryNurturingMilestonesRepository implements NurturingMilestonesRepository {
  readonly #organizations = new Map<string, NurturingOrganizationCounts>();

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
        : { organizationId, adminUserId, seeded, evaluationCount: 0, simulationRunCount: 0 },
    );
  }

  async countEvaluation({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationCounts[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    const counted = { ...organization, evaluationCount: organization.evaluationCount + 1 };
    this.#organizations.set(organizationId, counted);
    return [counted];
  }

  async countSimulationRun({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<NurturingOrganizationCounts[]> {
    const organization = this.#organizations.get(organizationId);
    if (!organization) return [];
    const counted = { ...organization, simulationRunCount: organization.simulationRunCount + 1 };
    this.#organizations.set(organizationId, counted);
    return [counted];
  }
}
