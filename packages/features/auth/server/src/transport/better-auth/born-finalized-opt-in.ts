import { extractEmailDomain, normalizedRequestPathname } from "@langwatch/auth-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

const logger = createLogger("langwatch:identity:born-finalized-opt-in");

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
  prisma,
  request,
}: {
  featureFlags: FeatureFlagService;
  prisma: PrismaClient;
  request: Request;
}): Promise<boolean> {
  if (request.method !== "POST") return false;
  const pathname = normalizedRequestPathname(request.url);
  if (!pathname.endsWith(SIGN_UP_PATH_SUFFIX)) return false;

  const email = await signUpEmailOf(request);
  if (email === null) return false;

  try {
    const organizationId = await organizationForDomain({ prisma, email });
    // Sign-up time: the person has no project and no user id yet, and an
    // organization only when their email domain matches one. With no
    // organization the read carries no targeting identity at all, so no rule
    // naming a project or an organization can match it and the registry
    // default (off) stands — which is the safe direction this gate wants.
    return await featureFlags.isEnabled(
      BORN_FINALIZED_SIGNUP_FLAG,
      organizationId === null ? { kind: "system" } : { kind: "organization", organizationId },
    );
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
async function signUpEmailOf(request: Request): Promise<string | null> {
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

/** The organization the address's domain names, when one claims it. */
async function organizationForDomain({
  prisma,
  email,
}: {
  prisma: PrismaClient;
  email: string;
}): Promise<string | null> {
  const domain = extractEmailDomain(email);
  if (domain === null) return null;
  const organization = await prisma.organization.findUnique({
    where: { ssoDomain: domain },
    select: { id: true },
  });
  return organization?.id ?? null;
}
