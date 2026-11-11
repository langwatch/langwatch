// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { NurturingOrganizationCreatedRepository } from "../nurturing-organization-created.repository.ts";

/** The Postgres twin's semantics: the earliest creation per organization is kept. */
export class MemoryNurturingOrganizationCreatedRepository implements NurturingOrganizationCreatedRepository {
  readonly #createdAt: Map<string, number>;

  private constructor(createdAt: ReadonlyMap<string, number>) {
    this.#createdAt = new Map(createdAt);
  }

  /** `createdAt` maps each organization nurturing saw created to its creation, in epoch ms. */
  static create({
    createdAt = new Map<string, number>(),
  }: {
    createdAt?: ReadonlyMap<string, number>;
  } = {}): MemoryNurturingOrganizationCreatedRepository {
    return new MemoryNurturingOrganizationCreatedRepository(createdAt);
  }

  async recordOrganizationCreated({
    organizationId,
    createdAt,
  }: Readonly<{ organizationId: string; createdAt: number }>): Promise<void> {
    const known = this.#createdAt.get(organizationId);
    if (known === undefined || createdAt < known) this.#createdAt.set(organizationId, createdAt);
  }

  async findOrganizationCreatedAt({
    organizationId,
  }: Readonly<{ organizationId: string }>): Promise<{ organizationCreatedAt: number | null }> {
    return { organizationCreatedAt: this.#createdAt.get(organizationId) ?? null };
  }

  async findOrganizationIdsCreatedBetween({
    after,
    upTo,
  }: Readonly<{ after: number; upTo: number }>): Promise<string[]> {
    return [...this.#createdAt]
      .filter(([, createdAt]) => createdAt > after && createdAt <= upTo)
      .map(([organizationId]) => organizationId);
  }
}
