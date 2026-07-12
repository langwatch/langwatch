/**
 * Data-access layer for the Langy ↔ GitHub per-user connection: the
 * `UserGitHubCredential` rows plus the `organizationUser` reads this feature
 * gates on (org membership for connect/callback, first-admin resolution for
 * secret attribution). The credentials service is the only caller; no transport
 * layer touches Prisma for this feature. Issue #4747.
 *
 * NOTE (revamp target, task #24): `isOrganizationMember` / `findFirstAdminUserId`
 * read our `organizationUser` table, not a GitHub credential — they do not
 * belong on THIS repository and should move to an org-membership concern when
 * the GitHub flow is rewritten.
 */

/** The encrypted credential a turn needs to mint a GitHub access token. */
export interface LangyGithubCredentialRow {
  encryptedRefreshToken: string;
  githubLogin: string;
}

/** The connection metadata surfaced in the "Acting as @login" UI. */
export interface LangyGithubConnection {
  githubLogin: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpsertLangyGithubCredentialInput {
  userId: string;
  organizationId: string;
  githubLogin: string;
  githubUserId: string;
  encryptedRefreshToken: string;
  scopes: string | null;
}

export interface LangyUserGithubCredentialsRepository {
  findCredential(params: {
    userId: string;
    organizationId: string;
  }): Promise<LangyGithubCredentialRow | null>;

  findConnection(params: {
    userId: string;
    organizationId: string;
  }): Promise<LangyGithubConnection | null>;

  upsert(input: UpsertLangyGithubCredentialInput): Promise<void>;

  updateRefreshToken(params: {
    userId: string;
    organizationId: string;
    encryptedRefreshToken: string;
  }): Promise<void>;

  deleteByUserOrg(params: {
    userId: string;
    organizationId: string;
  }): Promise<number>;

  isOrganizationMember(params: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;

  /** The org's first ADMIN, for attributing auto-provisioned secrets. */
  findFirstAdminUserId(organizationId: string): Promise<string | null>;
}

export class NullLangyUserGithubCredentialsRepository
  implements LangyUserGithubCredentialsRepository
{
  async findCredential(): Promise<LangyGithubCredentialRow | null> {
    return null;
  }
  async findConnection(): Promise<LangyGithubConnection | null> {
    return null;
  }
  async upsert(): Promise<void> {}
  async updateRefreshToken(): Promise<void> {}
  async deleteByUserOrg(): Promise<number> {
    return 0;
  }
  async isOrganizationMember(): Promise<boolean> {
    return false;
  }
  async findFirstAdminUserId(): Promise<string | null> {
    return null;
  }
}
