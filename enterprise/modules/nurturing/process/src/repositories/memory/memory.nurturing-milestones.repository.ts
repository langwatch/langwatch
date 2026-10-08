// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMilestonesRepository,
  NurturingOrganizationState,
} from "../nurturing-milestones.repository.ts";

type StoredOrganization = Omit<NurturingOrganizationState, "firstProjectCreatedAt">;

/** The Postgres twin's semantics; `placed` and `created` stand in for the owners' tables. */
export class MemoryNurturingMilestonesRepository implements NurturingMilestonesRepository {
  readonly #organizations = new Map<string, StoredOrganization>();

  private constructor(
    private readonly placed: ReadonlyMap<string, string>,
    private readonly created: ReadonlyMap<string, number>,
  ) {}

  /** `placed` maps each held project to its organization, `created` to its creation (epoch ms). */
  static create({
    placed = new Map<string, string>(),
    created = new Map<string, number>(),
  }: {
    placed?: ReadonlyMap<string, string>;
    created?: ReadonlyMap<string, number>;
  } = {}): MemoryNurturingMilestonesRepository {
    return new MemoryNurturingMilestonesRepository(placed, created);
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
    return [this.withFirstProject(counted)];
  }

  async countSimulationRun({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    const organization = this.#organizations.get(this.placed.get(projectId) ?? "");
    if (!organization) return [];
    const counted = { ...organization, simulationRunCount: organization.simulationRunCount + 1 };
    this.#organizations.set(organization.organizationId, counted);
    return [this.withFirstProject(counted)];
  }

  private withFirstProject(organization: StoredOrganization): NurturingOrganizationState {
    const createdAts = [...this.placed]
      .filter(([, organizationId]) => organizationId === organization.organizationId)
      .flatMap(([projectId]) => this.created.get(projectId) ?? []);
    const firstProjectCreatedAt = createdAts.length > 0 ? Math.min(...createdAts) : null;
    return { ...organization, firstProjectCreatedAt };
  }
}
