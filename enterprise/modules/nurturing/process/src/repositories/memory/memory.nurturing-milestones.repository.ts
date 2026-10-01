// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingMilestonesRepository,
  NurturingOrganizationState,
} from "../nurturing-milestones.repository.ts";

/** The Postgres twin's semantics over two maps. */
export class MemoryNurturingMilestonesRepository implements NurturingMilestonesRepository {
  readonly #projects = new Map<string, string>();
  readonly #organizations = new Map<string, NurturingOrganizationState>();

  static create(): MemoryNurturingMilestonesRepository {
    return new MemoryNurturingMilestonesRepository();
  }

  async recordProject({
    projectId,
    organizationId,
    adminUserId,
    seeded,
  }: Parameters<NurturingMilestonesRepository["recordProject"]>[0]): Promise<void> {
    const known = this.#organizations.get(organizationId);
    this.#organizations.set(
      organizationId,
      known
        ? { ...known, adminUserId: adminUserId ?? known.adminUserId }
        : { organizationId, adminUserId, seeded, evaluationCount: 0 },
    );
    this.#projects.set(projectId, organizationId);
  }

  async countEvaluation({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingOrganizationState[]> {
    const organization = this.#organizations.get(this.#projects.get(projectId) ?? "");
    if (!organization) return [];
    const counted = { ...organization, evaluationCount: organization.evaluationCount + 1 };
    this.#organizations.set(organization.organizationId, counted);
    return [counted];
  }
}
