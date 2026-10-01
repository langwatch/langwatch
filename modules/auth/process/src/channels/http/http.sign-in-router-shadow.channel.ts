import { compareToLegacy, type RoutingDecision } from "@langwatch/identity-contract";
import { createLogger } from "@langwatch/observability";

/**
 * Router for comparison against legacy answer. Port (not import) because router
 * reads deployment's own projection, legacy provider is deployment's environment.
 */
export abstract class SignInRouterShadow {
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
 * IDENTITY_ROUTER_V2 value (ADR-117 §7): off (legacy only), shadow (compare
 * decisions), or enforce (router decides). Rollback is this value.
 */
export type SignInRouterMode = "off" | "shadow" | "enforce";

/**
 * The paths that START a login — deliberately narrower than the gate's path
 * classification, since shadow mode is a per-LOGIN comparison and running it
 * on session reads would compare against a request the legacy door never routed.
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
 * `/sign-in/email` carries one — a social/OIDC initiation has none, which is
 * exactly the no-address case the router answers with the sole-connection rule.
 */
function extractSubmittedIdentifier(body: unknown): string | null {
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
 * Shadow mode's whole live-path footprint (ADR-117 §7). It cannot change a
 * sign-in: it returns a report and throws nothing, since a shadow comparison
 * must never become the reason someone cannot log in.
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
  shadow: SignInRouterShadow;
}): Promise<ShadowRun> {
  if (shadow.mode() !== "shadow") return DID_NOT_RUN;
  if (!isSignInInitiationPath(pathname)) return DID_NOT_RUN;

  try {
    const [decision, legacyProvider] = await Promise.all([
      shadow.route({
        identifier: extractSubmittedIdentifier(body),
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
