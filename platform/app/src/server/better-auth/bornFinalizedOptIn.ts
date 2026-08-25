import { extractEmailDomain } from "@ee/sso/matching";
import { normalizedRequestPathname } from "@ee/sso/ssoPathGate";
import { createLogger } from "@langwatch/observability";
import { prisma } from "~/server/db";
import { featureFlagService } from "~/server/featureFlag";

const logger = createLogger("langwatch:identity:born-finalized-opt-in");

/**
 * The allowlist ADR-116 §3 puts in front of the born-finalized entrance.
 * Per organization, evaluated in the backend, never trusted from the client.
 */
export const BORN_FINALIZED_SIGNUP_FLAG =
  "release_identity_born_finalized_signup" as const;

/**
 * better-auth's own email sign-up route, normalized.
 *
 * Normalization is load-bearing rather than tidy: rou3 resolves
 * `/sign-up/email/` to the same handler, so a raw-suffix match would let a
 * one-character variant walk past this check — the same trap
 * `ssoPathGate.ts` documents for the SSO gates.
 */
const SIGN_UP_PATH_SUFFIX = "/sign-up/email";

/**
 * Whether THIS request may create its user on the identity branch.
 *
 * ## Where the decision has to be made
 *
 * At the route boundary, and nowhere lower. The storage adapter cannot ask
 * the question — the user does not exist yet, so there is no organization to
 * evaluate a flag against and no state row for the gate to read. Below this
 * function the answer is carried as a request-scoped marker and nothing
 * re-decides it.
 *
 * ## What the request actually tells us
 *
 * Only the email address. better-auth's sign-up body is `{ name, email,
 * password, callbackURL }` — no organization id, no invite token; the invite
 * is redeemed on a separate page after sign-in. So the organization is
 * resolved the same way `afterUserCreate` resolves it: by the address's
 * domain against `Organization.ssoDomain`. For the common case of a fresh
 * signup at a non-SSO domain there IS no organization, and an org-targeted
 * rule correctly does not match — which keeps the entrance off, which is the
 * safe direction.
 *
 * ## What is NOT covered, said plainly
 *
 * **The product's own sign-up page.** It posts to `api.user.register`, which
 * writes the `User` row through Prisma directly and never reaches
 * `auth.api.signUpEmail` — so it does not pass this gate at all, and today
 * the entrance is reachable only by a client calling better-auth's sign-up
 * route itself. Routing the tRPC path through `auth.api.signUpEmail` is
 * future work (ADR-116 §3); until it lands, a flagged organization signing up
 * through the UI is created on the legacy branch and adopted by the backfill.
 *
 * A social sign-up. A new user minted inside an OAuth callback arrives on
 * the same URL an existing user's sign-in uses, with no address in the body
 * to evaluate a flag against, so it is indistinguishable here and takes the
 * legacy branch. That is a gap in the entrance's reach, not in its
 * correctness: an unflagged sign-up behaves exactly as it always has, and
 * the backfill adopts the user afterwards like any other.
 *
 * Fails CLOSED on everything: a body it cannot parse, a flag it cannot
 * read, a lookup that throws. Off means "created the way it always was".
 */
export async function isBornFinalizedSignUp({
  request,
}: {
  request: Request;
}): Promise<boolean> {
  if (request.method !== "POST") return false;
  const pathname = normalizedRequestPathname(request.url);
  if (!pathname.endsWith(SIGN_UP_PATH_SUFFIX)) return false;

  const email = await signUpEmailOf(request);
  if (email === null) return false;

  try {
    const organizationId = await organizationForDomain(email);
    return await featureFlagService.isEnabled(BORN_FINALIZED_SIGNUP_FLAG, {
      distinctId: email,
      defaultValue: false,
      ...(organizationId === null ? {} : { organizationId }),
    });
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
      typeof body === "object" && body !== null
        ? (body as { email?: unknown }).email
        : undefined;
    return typeof email === "string" && email.length > 0 ? email : null;
  } catch {
    // A body that is not JSON is not better-auth's sign-up shape.
    return null;
  }
}

/** The organization the address's domain names, when one claims it. */
async function organizationForDomain(email: string): Promise<string | null> {
  const domain = extractEmailDomain(email);
  if (domain === null) return null;
  const organization = await prisma.organization.findUnique({
    where: { ssoDomain: domain },
    select: { id: true },
  });
  return organization?.id ?? null;
}
