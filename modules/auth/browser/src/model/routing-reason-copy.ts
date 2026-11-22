import type { SignInRoutingReasonCode } from "@langwatch/identity-contract";

/** Customer-facing copy for routing reason codes; map is exhaustive at type level. */
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
  // The methods offered ARE the account's, which is the screen quietly doing
  // its job. Saying "these are your sign-in methods" over a list of somebody's
  // sign-in methods is a caption on a photograph of itself.
  account_methods: null,

  // ---- guidance ----
  identifier_unknown: {
    title: "There is no account for that email address yet",
    // Both ways on, and in this order: creating the account is what most
    // people who land here came to do, and the address being wrong is the
    // other real possibility rather than an afterthought.
    describe: "Create one now with the same address, or go back and try a different email.",
  },
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
    describe: "Ask a workspace administrator to invite you, then sign in again.",
  },
  link_proposed: {
    title: "An administrator needs to confirm this sign-in",
    describe:
      "Your workspace administrator has been asked to confirm it. Try again once they have.",
  },
} satisfies Record<SignInRoutingReasonCode, RoutingReasonCopy | null>;

/**
 * The copy for a reason code, or null when worth nothing on screen. Takes a
 * plain string and answers null for an unknown one: a wire value must
 * render nothing rather than putting itself on screen.
 */
export function signInRoutingReasonCopy(reasonCode: string): RoutingReasonCopy | null {
  return Object.hasOwn(routingReasonCopy, reasonCode)
    ? ((routingReasonCopy as Record<string, RoutingReasonCopy | null>)[reasonCode] ?? null)
    : null;
}

/** Test seam: the whole map, so a test can walk every code the router has. */
export const SIGN_IN_ROUTING_REASON_COPY: Readonly<
  Record<SignInRoutingReasonCode, RoutingReasonCopy | null>
> = routingReasonCopy;
