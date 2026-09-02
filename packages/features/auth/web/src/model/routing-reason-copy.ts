import type { SignInRoutingReasonCode } from "@langwatch/identity-contract";

/**
 * The words a routing reason code is worth on screen (D13, ADR-117 §6).
 *
 * Reason codes are vocabulary, never copy: the router answers
 * `connection_suspended`, and this is the one place that decides what a
 * person reads when it does. A screen that needs a new state needs a new
 * reason code first, and a new reason code lands here in the same change —
 * the map is exhaustive over the router's vocabulary at the type level, so
 * one that arrives without copy fails the typecheck.
 *
 * Most codes are worth nothing on screen, and say so with `null`. Routing to
 * an identity provider, offering the ordinary method set and answering an
 * address nobody has an account for are all the flow working; narrating them
 * would only tell the reader things they did not ask about, and the last one
 * would answer a question the front door refuses to answer at all
 * (ADR-117 §2).
 *
 * Two entries have counterparts in the error registry
 * (`identity_jit_disabled`, `identity_link_proposed`) because the same two
 * refusals also arrive as thrown errors on the callback path. The words are
 * written to match: one situation reads one way, whichever door it comes
 * through.
 */
export interface RoutingReasonCopy {
  title: string;
  /** What to do about it. Every guidance state has an action, or it is not
   *  guidance — it is a dead end wearing an explanation. */
  describe: string;
}

const routingReasonCopy = {
  // ---- the flow working: nothing to say ----
  sole_active_connection: null,
  break_glass: null,
  domain_routed: null,
  no_domain_match: null,

  // ---- guidance ----
  connection_suspended: {
    title: "Single sign-on is paused for your organization",
    describe:
      "Sign in another way below, or ask your workspace administrator when it will be back.",
  },
  method_not_licensed: {
    title: "Single sign-on is not available on this installation",
    describe:
      "Sign in with your email and password, or ask whoever runs LangWatch about single sign-on.",
  },
  method_not_configured: {
    title: "Single sign-on is not finished being set up",
    describe:
      "Sign in with your email and password, or ask whoever runs LangWatch to finish setting it up.",
  },
  jit_disabled: {
    title: "This workspace does not create accounts automatically",
    describe:
      "Ask a workspace administrator to invite you, then sign in again.",
  },
  link_proposed: {
    title: "An administrator needs to confirm this sign-in",
    describe:
      "Your workspace administrator has been asked to confirm it. Try again once they have.",
  },
} satisfies Record<SignInRoutingReasonCode, RoutingReasonCopy | null>;

/**
 * The copy for a reason code, or null when the code is worth nothing on
 * screen. Takes the code as a plain string and answers null for one it does
 * not know: the value arrives over the wire, and an unrecognised code must
 * render nothing rather than putting itself on screen.
 */
export function signInRoutingReasonCopy(
  reasonCode: string,
): RoutingReasonCopy | null {
  return Object.hasOwn(routingReasonCopy, reasonCode)
    ? ((routingReasonCopy as Record<string, RoutingReasonCopy | null>)[
        reasonCode
      ] ?? null)
    : null;
}

/** Test seam: the whole map, so a test can walk every code the router has. */
export const SIGN_IN_ROUTING_REASON_COPY: Readonly<
  Record<SignInRoutingReasonCode, RoutingReasonCopy | null>
> = routingReasonCopy;
