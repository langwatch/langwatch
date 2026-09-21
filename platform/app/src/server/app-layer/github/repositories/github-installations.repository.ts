/**
 * Data-access layer for the organization's GitHub connection (the
 * `GithubInstallation` rows) plus the `organizationUser` membership read the
 * install/webhook flow gates on. The installations service is the only caller;
 * no transport layer touches Prisma for this feature.
 *
 * Repository methods use findAll / findBy naming; the service exposes getAll /
 * getBy. No secret is stored — the App private key is the only credential and
 * it lives in the control-plane env, not the database.
 */

// biome-ignore-all lint/suspicious/noEmptyBlockStatements: Null* repositories implement the interface as intentional no-ops.

export interface GithubRepositoryRef {
  id: string;
  fullName: string;
}

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

export interface GithubInstallationsRepository {
  findAllForOrganization(
    organizationId: string,
  ): Promise<GithubInstallationRow[]>;

  findByInstallationId(
    installationId: string,
  ): Promise<GithubInstallationRow | null>;

  upsert(input: UpsertGithubInstallationInput): Promise<void>;

  /**
   * Atomically claims `installationId` for `input.organizationId`, or reports
   * who already holds it. The unique index on `installationId` — not a
   * read-then-write check the caller does itself — is what makes this
   * race-safe: two concurrent callers racing for the same fresh installation
   * id can never both see "absent" and both write, because only one `create`
   * can win the unique constraint. The loser always observes the winner's
   * committed row here, never a stale null.
   */
  insertOrGetExisting(
    input: UpsertGithubInstallationInput,
  ): Promise<{ wasInserted: boolean; row: GithubInstallationRow }>;

  setRepositories(params: {
    installationId: string;
    repositorySelection: string;
    repositories: GithubRepositoryRef[] | null;
  }): Promise<void>;

  setSuspended(params: {
    installationId: string;
    suspended: boolean;
  }): Promise<void>;

  deleteByInstallationId(installationId: string): Promise<number>;

  isOrganizationMember(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;
}

export class NullGithubInstallationsRepository
  implements GithubInstallationsRepository
{
  async findAllForOrganization(): Promise<GithubInstallationRow[]> {
    return [];
  }
  async findByInstallationId(): Promise<GithubInstallationRow | null> {
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
  async isOrganizationMember(): Promise<boolean> {
    return false;
  }
}
