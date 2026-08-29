/**
 * The user feature's application: what both of its doors call.
 *
 * A REST handler and a tRPC procedure are different usages — different
 * endpoints, different wire shapes, different reasons to exist — but they are
 * the same mechanism. Each declares its input, declares its access policy, and
 * then calls an operation here. Neither branches on domain state, because the
 * branch would exist twice and the two copies would answer differently the
 * first time one of them changed.
 *
 * The app is constructed once per process with the services and ports it
 * needs, and reaches a handler as `c.app`. Who is calling reaches it as
 * `c.auth`, separately: an operation takes the caller it acts for as an
 * argument rather than reading a session, so the same operation serves a
 * browser session, an API key and a background job without knowing which.
 */
import type { AuthService } from "@langwatch/auth-contract";
import { HandledError, remediation } from "@langwatch/handled-error";
import type { OpsService } from "@langwatch/ops-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectIdentity } from "@langwatch/project-contract";
import type { UserService } from "@langwatch/user-contract";

/**
 * The calling key belongs to a workspace that is not one person's.
 *
 * Handled rather than a plain `Error`: we know exactly what is wrong and the
 * caller has one step to take, which is to use the key from their own personal
 * workspace.
 */
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

/**
 * The calling key belongs to a user who does not own the personal workspace it
 * is pointed at.
 *
 * Nothing identifies the owner, on the error or in `meta`: whose workspace this
 * is answers the very question the refusal exists to withhold.
 */
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

/** What the process composes this feature's application from. */
export interface UserAppDependencies {
  users: UserService;
  auth: Pick<AuthService, "revokeOtherBrowserSessions" | "revokeAllBrowserSessions">;
  ops: Pick<OpsService, "isAdmin">;
  organizations: Pick<
    OrganizationService,
    "ensurePersonalWorkspace" | "tryFindPersonalWorkspace"
  >;
}

export class UserApp {
  static create(dependencies: UserAppDependencies): UserApp {
    return new UserApp(dependencies);
  }

  private constructor(private readonly dependencies: UserAppDependencies) {}

  /**
   * The user whose data a personal-workspace read answers for.
   *
   * Both doors ask this and neither may decide it. It lived in the REST
   * framework package, which made it reachable only from REST and put a domain
   * rule in a transport; the tRPC side had no way to call it and would have
   * grown a second copy.
   *
   * The guards, and why each is a refusal rather than a guess:
   *   - A shared or team workspace names no single person, so there is nobody
   *     to roll the answer up for.
   *   - A user-bound key pointed at somebody else's personal workspace would
   *     otherwise borrow their identity. `project:view` is not enough here:
   *     the question is whose data this is, not who may look at the project.
   *
   * A legacy project key carries no user of its own. It IS that workspace's
   * key, so its holder is the owner by construction and the ownership guard
   * has nothing to compare.
   *
   * @throws {PersonalProjectKeyRequiredError} when the workspace is not personal.
   * @throws {PersonalUsageKeyMismatchError} when a user-bound key does not own it.
   */
  personalCallerFor(input: {
    project: Pick<ProjectIdentity, "isPersonal" | "ownerUserId">;
    callerUserId: string | undefined;
  }): string {
    const { isPersonal, ownerUserId } = input.project;
    if (!isPersonal || !ownerUserId) {
      throw new PersonalProjectKeyRequiredError();
    }
    if (input.callerUserId && input.callerUserId !== ownerUserId) {
      throw new PersonalUsageKeyMismatchError();
    }

    return ownerUserId;
  }
}
