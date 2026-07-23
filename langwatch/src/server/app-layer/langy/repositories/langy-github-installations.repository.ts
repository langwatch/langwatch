/**
 * Data-access layer for Langy GitHub App installations (the
 * `LangyGithubInstallation` rows) plus the `organizationUser` membership read
 * the install/webhook flow gates on. The installations service is the only
 * caller; no transport layer touches Prisma for this feature. Issue #4747.
 *
 * Repository methods use findAll / findBy naming; the service exposes getAll /
 * getBy. No secret is stored — the App private key is the only credential and
 * it lives in the control-plane env, not the database.
 */

export interface LangyGithubRepositoryRef {
  id: string;
  fullName: string;
}

export interface LangyGithubInstallationRow {
  installationId: string;
  organizationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
  repositories: LangyGithubRepositoryRef[] | null;
  suspendedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertLangyGithubInstallationInput {
  installationId: string;
  organizationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
  repositories: LangyGithubRepositoryRef[] | null;
}

export interface LangyGithubInstallationsRepository {
  findAllForOrganization(
    organizationId: string,
  ): Promise<LangyGithubInstallationRow[]>;

  findByInstallationId(
    installationId: string,
  ): Promise<LangyGithubInstallationRow | null>;

  upsert(input: UpsertLangyGithubInstallationInput): Promise<void>;

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
    input: UpsertLangyGithubInstallationInput,
  ): Promise<{ inserted: boolean; row: LangyGithubInstallationRow }>;

  setRepositories(params: {
    installationId: string;
    repositorySelection: string;
    repositories: LangyGithubRepositoryRef[] | null;
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

export class NullLangyGithubInstallationsRepository
  implements LangyGithubInstallationsRepository
{
  async findAllForOrganization(): Promise<LangyGithubInstallationRow[]> {
    return [];
  }
  async findByInstallationId(): Promise<LangyGithubInstallationRow | null> {
    return null;
  }
  async upsert(): Promise<void> {}
  async insertOrGetExisting(
    input: UpsertLangyGithubInstallationInput,
  ): Promise<{ inserted: boolean; row: LangyGithubInstallationRow }> {
    const now = new Date();
    return {
      inserted: true,
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
