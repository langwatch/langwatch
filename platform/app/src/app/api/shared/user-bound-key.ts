/**
 * Who is behind an organization-scoped API key.
 *
 * Some organization-level reads answer for the CALLER rather than for the
 * organization: the coding-agent pull-request usage rollup is the caller's own
 * permission cut across the organization's projects. An `sk-lw` key created
 * for a user carries that user (`apiKeyUserId`); an organization service key —
 * a provisioning or automation credential created with no user — authenticates
 * fine but answers for nobody, so there is no caller to cut the answer by.
 *
 * Handled rather than a plain `Error` (ADR-045): we know exactly what is wrong
 * and the caller has one step to take, which is to send a key created for
 * their own user.
 */
import { HandledError } from "@langwatch/handled-error";

import { remediation } from "~/server/app-layer/error-remediation";

/** The calling organization key names no user to answer for. */
export class UserBoundKeyRequiredError extends HandledError {
  declare readonly code: "user_bound_key_required";

  constructor(options: { reasons?: readonly Error[] } = {}) {
    super(
      "user_bound_key_required",
      "This endpoint answers for the calling user, so it requires an API key created for a user. The key sent is an organization service key that belongs to no user.",
      {
        httpStatus: 400,
        fault: "customer",
        ...remediation("user_bound_key_required"),
        ...options,
      },
    );
    this.name = "UserBoundKeyRequiredError";
  }
}

/**
 * The user an organization credential acts as.
 *
 * @throws {UserBoundKeyRequiredError} when the key carries no user.
 */
export function requireUserBoundCaller({
  apiKeyUserId,
}: {
  apiKeyUserId: string | null;
}): string {
  if (!apiKeyUserId) {
    throw new UserBoundKeyRequiredError();
  }
  return apiKeyUserId;
}
