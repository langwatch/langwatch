import {
  compareToLegacy,
  type RoutingDecision,
} from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

/**
 * The router half of the comparison, and the legacy answer it is compared
 * against, as the process supplies them.
 *
 * A port rather than an import for the same reason everything else on this
 * transport is: the router reads the deployment's own connection projection,
 * and the legacy provider is the deployment's own environment. Neither is this
 * package's to resolve, and a shadow run that resolved them for itself would
 * be comparing two answers the live path never gave.
 */
export abstract class SignInRouterShadowPort {
  /** `IDENTITY_ROUTER_V2` as this deployment set it. */
  abstract mode(): SignInRouterMode;

  abstract route(input: {
    identifier: string | null;
    breakGlass: boolean;
  }): Promise<RoutingDecision>;

  /** What the legacy front door actually answered for this deployment. */
  abstract resolveAuthProvider(): Promise<string>;
}

const logger = createLogger("langwatch:identity:signin-router-shadow");

/**
 * `IDENTITY_ROUTER_V2` as the live path reads it (ADR-117 §7).
 *
 *   off      the legacy path is byte-for-byte untouched — this module returns
 *            before it computes, reads or logs anything at all.
 *   shadow   the router decides on every live login, the decision is compared
 *            against what the legacy path actually answered, and mismatches
 *            are logged with both. Behavior is never changed, in either
 *            direction, for any reason.
 *   enforce  the flip. The screens that render decisions are D13's slice, so
 *            today enforce reaches the engine and the services and changes
 *            nothing a person can see.
 *
 * Rollback is this value.
 */
export type SignInRouterMode = "off" | "shadow" | "enforce";

/**
 * The paths that START a login. Deliberately narrower than the gate's path
 * classification: shadow mode is a per-LOGIN comparison, and running it on
 * session reads would compare the router against a request the legacy front
 * door never routed.
 */
const SIGNIN_INITIATION_SUFFIXES = [
  "/sign-in/email",
  "/sign-in/social",
  "/sign-in/oauth2",
] as const;

export function isSignInInitiationPath(pathname: string): boolean {
  return SIGNIN_INITIATION_SUFFIXES.some((suffix) => pathname.endsWith(suffix));
}

/** What a shadow run answers, so a test can assert on it without a log. */
export interface ShadowRun {
  ran: boolean;
  matches?: boolean;
  routerProvider?: string;
  legacyProvider?: string;
  reasonCode?: string;
}

const DID_NOT_RUN: ShadowRun = { ran: false };

/**
 * Reads the address out of a sign-in request without trusting it. Only
 * `/sign-in/email` carries one; a social or OIDC initiation has none, which is
 * exactly the no-address case the router answers with the sole-connection
 * rule.
 */
function submittedIdentifier(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const email = (body as { email?: unknown }).email;
  return typeof email === "string" && email.length > 0 ? email : null;
}

function breakGlassRequested(url: string): boolean {
  try {
    return new URL(url).searchParams.get("local") === "1";
  } catch {
    return false;
  }
}

/**
 * Shadow mode's whole live-path footprint (ADR-117 §7).
 *
 * It cannot change a sign-in: it returns a report and throws nothing. Every
 * failure inside — an unreachable database, a router defect, a port that has
 * not been composed — is caught here and logged, because the one thing a
 * shadow comparison must never do is become the reason someone cannot log in.
 */
export async function runSignInRouterShadow({
  pathname,
  url,
  body,
  shadow,
}: {
  pathname: string;
  url: string;
  body: unknown;
  shadow: SignInRouterShadowPort;
}): Promise<ShadowRun> {
  if (shadow.mode() !== "shadow") return DID_NOT_RUN;
  if (!isSignInInitiationPath(pathname)) return DID_NOT_RUN;

  try {
    const [decision, legacyProvider] = await Promise.all([
      shadow.route({
        identifier: submittedIdentifier(body),
        breakGlass: breakGlassRequested(url),
      }),
      shadow.resolveAuthProvider(),
    ]);
    const comparison = compareToLegacy({ decision, legacyProvider });

    if (!comparison.matches) {
      logger.warn(
        {
          path: pathname,
          reasonCode: comparison.reasonCode,
          routerDecision: {
            outcome: decision.outcome,
            connectionId: decision.connectionId ?? null,
            methods: decision.methodSet.map((method) => method.id),
          },
          routerProvider: comparison.routerProvider,
          legacyProvider: comparison.legacyProvider,
        },
        "identity router shadow mismatch: the router and the legacy path disagreed; the legacy answer was used",
      );
    }

    return { ran: true, ...comparison };
  } catch (error) {
    logger.warn(
      { path: pathname, error },
      "identity router shadow comparison failed; the sign-in is unaffected",
    );
    return DID_NOT_RUN;
  }
}
