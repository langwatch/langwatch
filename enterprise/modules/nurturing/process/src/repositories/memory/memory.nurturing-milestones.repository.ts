// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMilestonesRepository,
  NurturingOrganizationState,
} from "../nurturing-milestones.repository.ts";

/** The Postgres twin's semantics; `placed` stands in for project's and organization's tables. */
export class MemoryNurturingMilestonesRepository implements NurturingMilestonesRepository {
  readonly #organizations = new Map<string, NurturingOrganizationState>();

  private constructor(private readonly placed: ReadonlyMap<string, string>) {}

  /** `placed` maps each project its owners hold to its organization. */
  static create({
    placed = new Map<string, string>(),
  }: { placed?: ReadonlyMap<string, string> } = {}): MemoryNurturingMilestonesRepository {
    return new MemoryNurturingMilestonesRepository(placed);
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
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    const organization = this.#organizations.get(this.placed.get(projectId) ?? "");
    if (!organization) return [];
    const counted = { ...organization, evaluationCount: organization.evaluationCount + 1 };
    this.#organizations.set(organization.organizationId, counted);
    return [counted];
  }

  async countSimulationRun({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    const organization = this.#organizations.get(this.placed.get(projectId) ?? "");
    if (!organization) return [];
    const counted = { ...organization, simulationRunCount: organization.simulationRunCount + 1 };
    this.#organizations.set(organization.organizationId, counted);
    return [counted];
  }
}
