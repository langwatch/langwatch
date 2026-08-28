/**
 * Who is behind a personal-workspace API key.
 *
 * Two REST reads answer for a PERSON rather than a project: `/api/me/usage` and
 * the coding agent's pull-request usage. Both need the same two guards, and
 * both live here rather than in each route, so one refusal cannot answer in two
 * shapes.
 *
 * The guards, and why each is a refusal rather than a guess:
 *   - A shared or team workspace names no single person, so there is nobody to
 *     roll the answer up for.
 *   - A user-bound key pointed at somebody else's personal workspace would
 *     otherwise borrow their identity. `project:view` is not enough here: the
 *     question is whose data this is, not who may look at the project.
 *
 * A legacy project key carries no user of its own. It IS that workspace's key,
 * so its holder is the owner by construction and the ownership guard has
 * nothing to compare.
 */
import { HandledError, remediation } from "@langwatch/handled-error";


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

/**
 * The user whose data a personal-workspace read answers for.
 *
 * @throws {PersonalProjectKeyRequiredError} when the workspace is not personal.
 * @throws {PersonalUsageKeyMismatchError} when a user-bound key does not own it.
 */
export function resolvePersonalCaller({
  project,
  apiKeyUserId,
}: {
  project: { isPersonal: boolean | null; ownerUserId: string | null };
  apiKeyUserId: string | undefined;
}): string {
  if (!project.isPersonal || !project.ownerUserId) {
    throw new PersonalProjectKeyRequiredError();
  }
  if (apiKeyUserId && apiKeyUserId !== project.ownerUserId) {
    throw new PersonalUsageKeyMismatchError();
  }
  return project.ownerUserId;
}
