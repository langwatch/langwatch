import type { ProjectPlacement, TenancyRepository } from "../tenancy.repository.ts";
import type { MemoryEntitlementDatabase } from "./memory.entitlement.database.ts";

/**
 * Placement and pricing columns over rows a test put there: an organisation owns
 * the projects its `projectCosts` names, as a Project row's team names it in Postgres.
 */
export class MemoryTenancyRepository implements TenancyRepository {
  #database: MemoryEntitlementDatabase;

  private constructor(database: MemoryEntitlementDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ memory: MemoryEntitlementDatabase }>): MemoryTenancyRepository {
    return new MemoryTenancyRepository(input.memory);
  }

  async getProjectPlacement({ projectId }: { projectId: string }): Promise<ProjectPlacement> {
    const owner = this.#database
      .all()
      .find((organization) => Object.hasOwn(organization.projectCosts, projectId));

    return owner ? { kind: "placed", organizationId: owner.organizationId } : { kind: "unplaced" };
  }

  async findProjectIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return Object.keys(this.#database.find(organizationId)?.projectCosts ?? {});
  }

  async findMeteredOrganizationIds(): Promise<string[]> {
    return this.#database
      .all()
      .filter((organization) => Object.keys(organization.projectCosts).length > 0)
      .map((organization) => organization.organizationId);
  }

  async getCurrency({ organizationId }: { organizationId: string }): Promise<"USD" | "EUR"> {
    return this.#database.find(organizationId)?.currency ?? "EUR";
  }

  async getDatasetLimits({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ attachmentMaxMb: number | null }> {
    return { attachmentMaxMb: this.#database.find(organizationId)?.datasetAttachmentMaxMb ?? null };
  }
}
