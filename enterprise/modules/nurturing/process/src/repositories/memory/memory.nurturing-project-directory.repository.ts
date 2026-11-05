// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingProjectDirectoryRepository,
  NurturingProjectPlacement,
} from "../nurturing-project-directory.repository.ts";

/** The Postgres twin's semantics; the maps stand in for the owners' tables. */
export class MemoryNurturingProjectDirectoryRepository implements NurturingProjectDirectoryRepository {
  private constructor(
    private readonly state: Readonly<{
      placed: ReadonlyMap<string, string>;
      created: ReadonlyMap<string, number>;
      organizationsCreated: ReadonlyMap<string, number>;
      traced: ReadonlySet<string>;
      personalOwners: ReadonlyMap<string, string>;
    }>,
  ) {}

  /**
   * `placed` maps each held project to its organization, `created` to its creation (epoch ms),
   * `organizationsCreated` each held organization to its own, `traced` holds the projects that
   * received their first message, and `personalOwners` maps each personal project to its owner.
   */
  static create({
    placed = new Map<string, string>(),
    created = new Map<string, number>(),
    organizationsCreated = new Map<string, number>(),
    traced = new Set<string>(),
    personalOwners = new Map<string, string>(),
  }: {
    placed?: ReadonlyMap<string, string>;
    created?: ReadonlyMap<string, number>;
    organizationsCreated?: ReadonlyMap<string, number>;
    traced?: ReadonlySet<string>;
    personalOwners?: ReadonlyMap<string, string>;
  } = {}): MemoryNurturingProjectDirectoryRepository {
    return new MemoryNurturingProjectDirectoryRepository({
      placed,
      created,
      organizationsCreated,
      traced,
      personalOwners,
    });
  }

  async findPersonalOwnerUserIds({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<string[]> {
    const owner = this.state.personalOwners.get(projectId);
    return owner === undefined ? [] : [owner];
  }

  async hasTracedProject({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<boolean> {
    return [...this.state.placed].some(
      ([projectId, placedIn]) => placedIn === organizationId && this.state.traced.has(projectId),
    );
  }

  async getPlacement({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement> {
    const organizationId = this.state.placed.get(projectId);
    return organizationId === undefined
      ? { outcome: "unknown" }
      : { outcome: "known", organizationId };
  }

  async getFirstProjectCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ firstProjectCreatedAt: number | null }> {
    const createdAts = [...this.state.placed]
      .filter(([, placedIn]) => placedIn === organizationId)
      .flatMap(([projectId]) => this.state.created.get(projectId) ?? []);
    return { firstProjectCreatedAt: createdAts.length > 0 ? Math.min(...createdAts) : null };
  }

  async getOrganizationCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ organizationCreatedAt: number | null }> {
    return { organizationCreatedAt: this.state.organizationsCreated.get(organizationId) ?? null };
  }
}
