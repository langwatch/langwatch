import type { AuthApi } from "@langwatch/auth-contract";
import type { AdminIdentity, OpsApi } from "@langwatch/ops-contract";
import type {
  EnsuredPersonalWorkspace,
  FindPersonalWorkspaceInput,
  OrganizationApi,
  PersonalWorkspace,
  PersonalWorkspaceInput,
} from "@langwatch/organization-contract";
import { HandledError, remediation } from "@langwatch/handled-error";

export class PersonalProjectKeyRequiredError extends HandledError {
  declare readonly code: "personal_project_key_required";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_project_key_required",
      "This endpoint requires a personal-workspace API key. Use the API key from your own personal workspace.",
      {
        httpStatus: 400,
        fault: "customer",
        ...remediation("personal_project_key_required"),
        ...options,
      },
    );
    this.name = "PersonalProjectKeyRequiredError";
  }
}

export class PersonalUsageKeyMismatchError extends HandledError {
  declare readonly code: "personal_usage_key_mismatch";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_usage_key_mismatch",
      "This API key cannot read another user's personal workspace. Use a key scoped to your own personal workspace.",
      {
        httpStatus: 403,
        fault: "customer",
        ...remediation("personal_usage_key_mismatch"),
        ...options,
      },
    );
    this.name = "PersonalUsageKeyMismatchError";
  }
}

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

  isAdmin(identity: AdminIdentity): boolean {
    return this.ops.isAdmin(identity);
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

  tryFindPersonalWorkspace(input: FindPersonalWorkspaceInput): Promise<PersonalWorkspace | null> {
    return this.organizations.tryFindPersonalWorkspace(input);
  }
}
