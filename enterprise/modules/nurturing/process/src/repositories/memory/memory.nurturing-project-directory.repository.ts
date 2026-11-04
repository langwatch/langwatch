// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  NurturingProjectDirectoryRepository,
  NurturingProjectPlacement,
} from "../nurturing-project-directory.repository.ts";

/** The Postgres twin's semantics; `placed` and `created` stand in for the owners' tables. */
export class MemoryNurturingProjectDirectoryRepository implements NurturingProjectDirectoryRepository {
  private constructor(
    private readonly placed: ReadonlyMap<string, string>,
    private readonly created: ReadonlyMap<string, number>,
    private readonly traced: ReadonlySet<string>,
  ) {}

  /**
   * `placed` maps each held project to its organization, `created` to its creation (epoch ms),
   * and `traced` holds the projects that received their first message.
   */
  static create({
    placed = new Map<string, string>(),
    created = new Map<string, number>(),
    traced = new Set<string>(),
  }: {
    placed?: ReadonlyMap<string, string>;
    created?: ReadonlyMap<string, number>;
    traced?: ReadonlySet<string>;
  } = {}): MemoryNurturingProjectDirectoryRepository {
    return new MemoryNurturingProjectDirectoryRepository(placed, created, traced);
  }

  async hasTracedProject({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<boolean> {
    return [...this.placed].some(
      ([projectId, placedIn]) => placedIn === organizationId && this.traced.has(projectId),
    );
  }

  async getPlacement({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement> {
    const organizationId = this.placed.get(projectId);
    return organizationId === undefined
      ? { outcome: "unknown" }
      : { outcome: "known", organizationId };
  }

  async getFirstProjectCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ firstProjectCreatedAt: number | null }> {
    const createdAts = [...this.placed]
      .filter(([, placedIn]) => placedIn === organizationId)
      .flatMap(([projectId]) => this.created.get(projectId) ?? []);
    return { firstProjectCreatedAt: createdAts.length > 0 ? Math.min(...createdAts) : null };
  }
}
