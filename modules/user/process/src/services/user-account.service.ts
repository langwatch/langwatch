import type { AuthApi } from "@langwatch/auth-contract";
import type { AdminIdentity, OpsApi } from "@langwatch/ops-contract";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  OrganizationApi,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  PersonalUsageServiceKeyUnsupportedError,
  type MePersonalCredential,
  type UserBrowserSession,
  type UserBrowserSessionEnded,
} from "@langwatch/user-contract";

export class UserAccountService {
  private constructor(
    private readonly auth: AuthApi,
    private readonly organizations: OrganizationApi,
    private readonly ops: OpsApi,
  ) {}

  static create(dependencies: {
    auth: AuthApi;
    organizations: OrganizationApi;
    ops: OpsApi;
  }): UserAccountService {
    return new UserAccountService(dependencies.auth, dependencies.organizations, dependencies.ops);
  }

  personalCallerFor(input: {
    project: { isPersonal: boolean; ownerUserId: string | null };
    callerUserId: string | undefined;
  }): string {
    if (!input.project.isPersonal || !input.project.ownerUserId) {
      throw new PersonalProjectKeyRequiredError();
    }

    if (input.callerUserId && input.callerUserId !== input.project.ownerUserId) {
      throw new PersonalUsageKeyMismatchError();
    }

    return input.project.ownerUserId;
  }

  /**
   * The same resolution for a request that presents a CREDENTIAL rather than a
   * session. The key's class is half the decision: a service key belongs to
   * nobody and must not be read as this workspace's own legacy key.
   */
  personalUsageCallerFor(input: {
    project: { isPersonal: boolean; ownerUserId: string | null };
    credential: MePersonalCredential;
  }): string {
    if (!input.project.isPersonal || !input.project.ownerUserId) {
      throw new PersonalProjectKeyRequiredError();
    }

    if (input.credential.kind === "legacyProjectKey") return input.project.ownerUserId;
    if (input.credential.userId === null) throw new PersonalUsageServiceKeyUnsupportedError();

    return this.personalCallerFor({
      project: input.project,
      callerUserId: input.credential.userId,
    });
  }

  isAdmin(identity: AdminIdentity): boolean {
    return this.ops.isAdmin(identity);
  }

  /** The organization a personal workspace's team belongs to. */
  findOrganizationIdByTeamId(input: { teamId: string }): Promise<string | null> {
    return this.organizations.tryGetOrganizationIdByTeamId(input);
  }

  /**
   * Auth owns the session rows; this surface owns the words a `/me` reader
   * sees. The field-by-field copy is what makes that a typechecked agreement
   * rather than an assumption that the two shapes stay identical.
   */
  async listBrowserSessions(input: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<UserBrowserSession[]> {
    const sessions = await this.auth.listBrowserSessions(input);

    return sessions.map((session) => ({
      sessionId: session.sessionId,
      identifierId: session.identifierId,
      method: session.method,
      secondFactorProven: session.secondFactorProven,
      ipAddress: session.ipAddress,
      userAgent: session.userAgent,
      signedInAt: session.signedInAt,
      lastActiveAt: session.lastActiveAt,
      expiresAt: session.expiresAt,
      current: session.current,
    }));
  }

  endBrowserSession(input: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<UserBrowserSessionEnded> {
    return this.auth.endBrowserSession(input);
  }

  revokeOtherBrowserSessions(input: { userId: string; keepSessionId: string }): Promise<void> {
    return this.auth.revokeOtherBrowserSessions(input);
  }

  revokeAllBrowserSessions(input: { userId: string }): Promise<void> {
    return this.auth.revokeAllBrowserSessions(input);
  }

  ensurePersonalWorkspace(input: PersonalWorkspaceInput): Promise<EnsuredPersonalWorkspace> {
    return this.organizations.ensurePersonalWorkspace(input);
  }

  findPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.organizations.tryFindPersonalWorkspace(input);
  }
}
