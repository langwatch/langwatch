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
 *
 * A MODERN key with no user is a different credential entirely — a service
 * key, minted for a job rather than for a person, carrying its own bindings.
 * The two are indistinguishable from a user id alone, which is why this takes
 * the whole typed credential: without the credential CLASS, a service key
 * would answer as the workspace's owner, which is precisely the substitution
 * these guards exist to prevent.
 */
import { HandledError, remediation } from "@langwatch/handled-error";

import type { RestCredentialPrincipal } from "./credential-principal.ts";

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
 * The calling credential is a service key, which stands for no person.
 *
 * A personal read has to name whose data it answers for, and a service key
 * names nobody: answering for the workspace's owner would hand the key its
 * creator's identity rather than its own.
 */
export class PersonalUsageServiceKeyUnsupportedError extends HandledError {
  declare readonly code: "personal_usage_service_key_unsupported";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "personal_usage_service_key_unsupported",
      "This endpoint answers for one person, so a service API key cannot read it. Use an API key issued to you.",
      {
        httpStatus: 403,
        fault: "customer",
        ...remediation("personal_usage_service_key_unsupported"),
        ...options,
      },
    );
    this.name = "PersonalUsageServiceKeyUnsupportedError";
  }
}

/**
 * The user whose data a personal-workspace read answers for.
 *
 * Takes the resolved credential rather than fields picked off the request
 * context: the credential's CLASS is half the decision, and a caller that
 * reads two loose ids out of a context bag can only guess at it.
 *
 * @throws {PersonalProjectKeyRequiredError} when the workspace is not personal.
 * @throws {PersonalUsageKeyMismatchError} when a user-bound key does not own it.
 * @throws {PersonalUsageServiceKeyUnsupportedError} for an ownerless modern key.
 */
export function resolvePersonalCaller({
  project,
  credential,
}: {
  project: { isPersonal: boolean | null; ownerUserId: string | null };
  credential: RestCredentialPrincipal;
}): string {
  if (!project.isPersonal || !project.ownerUserId) {
    throw new PersonalProjectKeyRequiredError();
  }
  if (credential.kind === "legacyProjectKey") {
    return project.ownerUserId;
  }
  if (credential.userId === null) {
    throw new PersonalUsageServiceKeyUnsupportedError();
  }
  if (credential.userId !== project.ownerUserId) {
    throw new PersonalUsageKeyMismatchError();
  }
  return project.ownerUserId;
}
