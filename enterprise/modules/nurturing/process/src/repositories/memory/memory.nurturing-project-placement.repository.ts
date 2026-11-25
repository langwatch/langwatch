// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingProjectPlacement } from "../nurturing-project-directory.repository.ts";
import type { NurturingProjectPlacementRepository } from "../nurturing-project-placement.repository.ts";

/** The Postgres twin's semantics: one organization per project, rewritten on a redelivery. */
export class MemoryNurturingProjectPlacementRepository implements NurturingProjectPlacementRepository {
  readonly #placed: Map<string, string>;

  private constructor(placed: ReadonlyMap<string, string>) {
    this.#placed = new Map(placed);
  }

  /** `placed` maps each project nurturing saw created to its organization. */
  static create({
    placed = new Map<string, string>(),
  }: { placed?: ReadonlyMap<string, string> } = {}): MemoryNurturingProjectPlacementRepository {
    return new MemoryNurturingProjectPlacementRepository(placed);
  }

  async recordProject({
    projectId,
    organizationId,
  }: Readonly<{ projectId: string; organizationId: string }>): Promise<void> {
    this.#placed.set(projectId, organizationId);
  }

  async getPlacement({
    projectId,
  }: Readonly<{ projectId: string }>): Promise<NurturingProjectPlacement> {
    const organizationId = this.#placed.get(projectId);
    return organizationId === undefined
      ? { outcome: "unknown" }
      : { outcome: "known", organizationId };
  }

  async findProjectIds({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<string[]> {
    return [...this.#placed]
      .filter(([, placedIn]) => placedIn === organizationId)
      .map(([projectId]) => projectId);
  }
}
