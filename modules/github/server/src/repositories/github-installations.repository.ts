import type { GithubRepositoryRef } from "@langwatch/github-contract";
import { nowInstant, type Instant } from "@langwatch/time";

/**
 * Data-access layer for GitHub connections. Only called by the
 * installations service; no secrets stored.
 */

export type { GithubRepositoryRef } from "@langwatch/github-contract";

export interface GithubInstallationRow {
  installationId: string;
  organizationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
  repositories: GithubRepositoryRef[] | null;
  suspendedAt: Instant | null;
  createdAt: Instant;
  updatedAt: Instant;
}

export interface UpsertGithubInstallationInput {
  installationId: string;
  organizationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
  repositories: GithubRepositoryRef[] | null;
}

export abstract class GithubInstallationsRepository {
  abstract findAllForOrganization(organizationId: string): Promise<GithubInstallationRow[]>;

  abstract tryFindByInstallationId(installationId: string): Promise<GithubInstallationRow | null>;

  abstract upsert(input: UpsertGithubInstallationInput): Promise<void>;

  /**
   * Atomic claim of installationId using the unique index for race safety.
   * Returns who holds it if already claimed.
   */
  abstract insertOrGetExisting(
    input: UpsertGithubInstallationInput,
  ): Promise<{ wasInserted: boolean; row: GithubInstallationRow }>;

  abstract setRepositories(params: {
    installationId: string;
    repositorySelection: string;
    repositories: GithubRepositoryRef[] | null;
  }): Promise<void>;

  abstract setSuspended(params: { installationId: string; suspended: boolean }): Promise<void>;

  abstract deleteByInstallationId(installationId: string): Promise<number>;
}

export class NullGithubInstallationsRepository extends GithubInstallationsRepository {
  async findAllForOrganization(_organizationId: string): Promise<GithubInstallationRow[]> {
    return [];
  }
  async tryFindByInstallationId(): Promise<GithubInstallationRow | null> {
    return null;
  }
  async upsert(): Promise<void> {}
  async insertOrGetExisting(
    input: UpsertGithubInstallationInput,
  ): Promise<{ wasInserted: boolean; row: GithubInstallationRow }> {
    const now = nowInstant();
    return {
      wasInserted: true,
      row: { ...input, suspendedAt: null, createdAt: now, updatedAt: now },
    };
  }
  async setRepositories(): Promise<void> {}
  async setSuspended(): Promise<void> {}
  async deleteByInstallationId(): Promise<number> {
    return 0;
  }
}
