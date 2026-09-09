import { nowInstant } from "@langwatch/time";

import {
  GithubInstallationsRepository,
  type GithubInstallationRow,
  type GithubRepositoryRef,
  type UpsertGithubInstallationInput,
} from "../github-installations.repository.ts";
import { MemoryGithubDatabase } from "./memory.github.database.ts";

/**
 * The organization's connections in memory, keyed by installation id exactly
 * as the unique index keys them, so `insertOrGetExisting` reports the same
 * winner a race against Postgres would.
 */
export class MemoryGithubInstallationsRepository extends GithubInstallationsRepository {
  #database: MemoryGithubDatabase;

  private constructor(database: MemoryGithubDatabase) {
    super();
    this.#database = database;
  }

  static create(
    input: Readonly<{ memory: MemoryGithubDatabase }>,
  ): MemoryGithubInstallationsRepository {
    return new MemoryGithubInstallationsRepository(input.memory);
  }

  async findAllForOrganization(organizationId: string): Promise<GithubInstallationRow[]> {
    return [...this.#database.installations.values()]
      .filter((row) => row.organizationId === organizationId)
      .sort((left, right) => left.createdAt.epochMilliseconds - right.createdAt.epochMilliseconds);
  }

  async tryFindByInstallationId(installationId: string): Promise<GithubInstallationRow | null> {
    return this.#database.installations.get(installationId) ?? null;
  }

  async upsert(input: UpsertGithubInstallationInput): Promise<void> {
    const now = nowInstant();
    const stored = this.#database.installations.get(input.installationId);
    this.#database.installations.set(input.installationId, {
      ...input,
      repositories: input.repositories === null ? null : copyRepositories(input.repositories),
      suspendedAt: stored?.suspendedAt ?? null,
      createdAt: stored?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async insertOrGetExisting(
    input: UpsertGithubInstallationInput,
  ): Promise<{ wasInserted: boolean; row: GithubInstallationRow }> {
    const stored = this.#database.installations.get(input.installationId);
    if (stored) return { wasInserted: false, row: stored };

    const now = nowInstant();
    const row: GithubInstallationRow = {
      ...input,
      repositories: input.repositories === null ? null : copyRepositories(input.repositories),
      suspendedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.#database.installations.set(input.installationId, row);

    return { wasInserted: true, row };
  }

  async setRepositories(params: {
    installationId: string;
    repositorySelection: string;
    repositories: GithubRepositoryRef[] | null;
  }): Promise<void> {
    const stored = this.#database.installations.get(params.installationId);
    if (!stored) return;

    this.#database.installations.set(params.installationId, {
      ...stored,
      repositorySelection: params.repositorySelection,
      repositories: params.repositories === null ? null : copyRepositories(params.repositories),
      updatedAt: nowInstant(),
    });
  }

  async setSuspended(params: { installationId: string; suspended: boolean }): Promise<void> {
    const stored = this.#database.installations.get(params.installationId);
    if (!stored) return;

    this.#database.installations.set(params.installationId, {
      ...stored,
      suspendedAt: params.suspended ? nowInstant() : null,
      updatedAt: nowInstant(),
    });
  }

  async deleteByInstallationId(installationId: string): Promise<number> {
    const deleted = this.#database.installations.delete(installationId);

    return deleted ? 1 : 0;
  }
}

/** The stored repository list is the caller's array copied, never the array itself. */
function copyRepositories(repositories: GithubRepositoryRef[] | null): GithubRepositoryRef[] {
  return (repositories ?? []).map((repository) => ({ ...repository }));
}
