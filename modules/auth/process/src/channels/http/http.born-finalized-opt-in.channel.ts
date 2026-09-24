import { extractEmailDomain, normalizedRequestPathname } from "@langwatch/auth-contract";
import type { FeatureFlagApi, FeatureFlagTarget } from "@langwatch/feature-flag-contract";
import { HandledError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";

import type { AuthDirectory } from "../../app/auth.members.ts";

const logger = createLogger("langwatch:identity:born-finalized-opt-in.api");

/**
 * The allowlist ADR-116 §3 puts in front of the born-finalized entrance.
 * Per organization, evaluated in the backend, never trusted from the client.
 */
export const BORN_FINALIZED_SIGNUP_FLAG = "release_identity_born_finalized_signup" as const;

/**
 * better-auth's own email sign-up route, normalized.
 */
const SIGN_UP_PATH_SUFFIX = "/sign-up/email";

/**
 * Whether THIS request may create its user on the identity branch, gated by
 * the allowlist flag (ADR-116 §3).
 */
export async function isBornFinalizedSignUp({
  featureFlags,
  directory,
  request,
}: {
  featureFlags: FeatureFlagApi;
  directory: AuthDirectory;
  request: Request;
}): Promise<boolean> {
  if (request.method !== "POST") return false;
  const pathname = normalizedRequestPathname(request.url);
  if (!pathname.endsWith(SIGN_UP_PATH_SUFFIX)) return false;

  const email = await extractSignUpEmail(request);
  if (email === null) return false;

  try {
    const target = await getSignUpFlagTarget({ directory, email });
    // Sign-up time: the person has no project and no user id yet, and an
    // organization only when their email domain matches one. With no
    // organization the read carries no targeting identity at all, so no rule
    // naming a project or an organization can match it and the registry
    // default (off) stands — which is the safe direction this gate wants.
    return await featureFlags.isEnabled(BORN_FINALIZED_SIGNUP_FLAG, target);
  } catch (error) {
    // Never fail the sign-up over the flag itself: an unreadable flag means
    // the user is created the way every user was created before this
    // existed.
    logger.warn(
      { error },
      "could not evaluate the born-finalized sign-up flag; the sign-up takes the legacy branch",
    );
    return false;
  }
}

/** The address, read from a CLONE so better-auth still gets its body. */
async function extractSignUpEmail(request: Request): Promise<string | null> {
  try {
    const body: unknown = await request.clone().json();
    const email =
      typeof body === "object" && body !== null ? (body as { email?: unknown }).email : undefined;
    return typeof email === "string" && email.length > 0 ? email : null;
  } catch {
    // A body that is not JSON is not better-auth's sign-up shape.
    return null;
  }
}

/** The organization the address's domain names, or the system when none claims it. */
async function getSignUpFlagTarget({
  directory,
  email,
}: {
  directory: AuthDirectory;
  email: string;
}): Promise<FeatureFlagTarget> {
  const domain = extractEmailDomain(email);
  if (domain === null) return { kind: "system" };
  try {
    const organizationId = await directory.getOrganizationIdBySsoDomain(domain);
    return { kind: "organization", organizationId };
  } catch (error) {
    if (HandledError.isHandled(error) && error.code === "organization_not_found") {
      return { kind: "system" };
    }
    throw error;
  }
}
