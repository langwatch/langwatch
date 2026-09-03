import type { GithubRepositoryRef } from "@langwatch/github-contract";

/**
 * Data-access layer for the organization's GitHub connection. The
 * installations service is the only caller; no transport touches Prisma for
 * this feature.
 *
 * Repository methods use findAll / findBy naming; the service exposes getAll /
 * getBy. No secret is stored — the App private key is the only credential and
 * it lives in the control-plane env, not the database.
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
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
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
   * Atomically claims `installationId` for `input.organizationId`, or reports
   * who already holds it. The unique index on `installationId` — not a
   * read-then-write check the caller does itself — is what makes this
   * race-safe: two concurrent callers racing for the same fresh installation
   * id can never both see "absent" and both write, because only one `create`
   * can win the unique constraint. The loser always observes the winner's
   * committed row here, never a stale null.
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
    const now = new Date();
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
