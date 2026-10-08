import { NON_DESTINATION_PROJECT_KINDS, type Project } from "@langwatch/project-contract";

import type { AggregateRuleRepository } from "../aggregate-rule.repository.ts";
import type { MemoryProjectDatabase } from "./memory.project.database.ts";

function byId(left: Project, right: Project): number {
  return left.id.localeCompare(right.id);
}

/** The memory twin of the aggregate reads, over the shared project rows. */
export class MemoryAggregateRuleRepository implements AggregateRuleRepository {
  readonly #database: MemoryProjectDatabase;

  private constructor(database: MemoryProjectDatabase) {
    this.#database = database;
  }

  static create(input: Readonly<{ memory: MemoryProjectDatabase }>): MemoryAggregateRuleRepository {
    return new MemoryAggregateRuleRepository(input.memory);
  }

  async findPersonalProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; ownerUserId: string | null }[]> {
    return this.#readable(organizationId)
      .filter((project) => project.isPersonal)
      .toSorted(byId)
      .map(({ id, ownerUserId }) => ({ id, ownerUserId }));
  }

  async findReadableProjectIds({
    organizationId,
    projectIds,
  }: {
    organizationId: string;
    projectIds: readonly string[];
  }): Promise<string[]> {
    return this.#readable(organizationId)
      .filter((project) => projectIds.includes(project.id))
      .toSorted(byId)
      .map((project) => project.id);
  }

  async findCandidateProjects({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{ id: string; name: string; isPersonal: boolean; ownerUserId: string | null }[]> {
    return this.#readable(organizationId)
      .toSorted((left, right) => left.name.localeCompare(right.name) || byId(left, right))
      .map(({ id, name, isPersonal, ownerUserId }) => ({ id, name, isPersonal, ownerUserId }));
  }

  #readable(organizationId: string): Project[] {
    return this.#database.projects().filter((project) => {
      const team = this.#database.findTeam(project.teamId);
      return (
        project.archivedAt === null &&
        !NON_DESTINATION_PROJECT_KINDS.includes(project.kind) &&
        team?.organizationId === organizationId &&
        team.archivedAt === null
      );
    });
  }
}
