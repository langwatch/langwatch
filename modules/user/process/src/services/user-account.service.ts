import type { AuthApi } from "@langwatch/auth-contract";
import {
  type EnsuredPersonalWorkspace,
  type FindPersonalWorkspaceInput,
  type OrganizationApi,
  type PersonalWorkspace,
  TeamNotFoundError,
  type PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import {
  PersonalProjectKeyRequiredError,
  PersonalUsageKeyMismatchError,
  type UserBrowserSession,
  type UserBrowserSessionEnded,
} from "@langwatch/user-contract";

export class UserAccountService {
  private constructor(
    private readonly auth: AuthApi,
    private readonly organizations: OrganizationApi,
  ) {}

  static create(dependencies: {
    auth: AuthApi;
    organizations: OrganizationApi;
  }): UserAccountService {
    return new UserAccountService(dependencies.auth, dependencies.organizations);
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
    return this.organizations.getPersonalWorkspace(input).catch((error: unknown) => {
      if (TeamNotFoundError.is(error)) return null;
      throw error;
    });
  }
}
