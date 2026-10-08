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
