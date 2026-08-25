/**
 * What a connection is called and where it stands, in a customer's words.
 *
 * The aggregate's own vocabulary is `VERIFICATION_PENDING`, `TEARDOWN_PENDING`
 * and nine more like them. None of it is a customer's, and a screen that put
 * the raw value in a chip would be asking an administrator to learn our state
 * machine to find out whether their sign-in works.
 *
 * Total over every state on purpose. A table with a hole in it renders the
 * hole, and the one state nobody thought about is always the one somebody is
 * staring at when they need an answer.
 *
 * Framework-free, so the words can be pinned by a test that renders nothing.
 */

import type {
  SsoConnectionLifecycleState,
  SsoConnectionType,
} from "@langwatch/identity";

export type ConnectionChipTone = "neutral" | "good" | "warning" | "bad";

export interface ConnectionStatusChip {
  label: string;
  tone: ConnectionChipTone;
  /** The longer explanation, on hover. */
  title: string;
  /**
   * Whether this state is waiting on the READER rather than on a system.
   *
   * Exactly one state is: a connection whose domain is proved and which has
   * not been turned on. Everything else is either settled or waiting on
   * somebody else, and drew in the same grey, so the one step that had just
   * become possible looked like the four that were merely finished.
   *
   * The chip carries the same words either way — the sweep adds attention,
   * never meaning — and nothing moves for a reader who asked for less motion.
   */
  shimmer?: boolean;
}

/**
 * The connection named by the protocol it actually speaks.
 *
 * "Single sign-on" alone tells an administrator nothing they did not already
 * know from the page they are on; the protocol is what they configured at the
 * other end, and it is how they recognize their own connection.
 */
export function connectionProtocolName(type: SsoConnectionType): string {
  return type === "saml"
    ? "SAML single sign-on"
    : "OpenID Connect single sign-on";
}

/**
 * Where the connection stands, and — separately — whether anybody is being
 * sent to it.
 *
 * The two are different facts, and a live connection whose organization has
 * not been switched over is the case where saying only one of them misleads:
 * "Active" would tell somebody their rollout finished at the exact moment
 * nobody is being routed through it yet.
 */
export function connectionStatusChipFor({
  state,
  routingSwitchedOn,
}: {
  state: SsoConnectionLifecycleState;
  routingSwitchedOn: boolean;
}): ConnectionStatusChip {
  if (state === "ACTIVE") {
    return routingSwitchedOn
      ? {
          label: "Active",
          tone: "good",
          title:
            "People with an address at your proved domains sign in through your identity provider.",
        }
      : {
          label: "On, not routing yet",
          tone: "warning",
          title:
            "The connection works. Everyone still signs in the way they do today, until your organization is switched over.",
        };
  }
  return STEADY_STATES[state];
}

/** Every state a connection can rest in, other than the live one. */
const STEADY_STATES: Record<
  Exclude<SsoConnectionLifecycleState, "ACTIVE">,
  ConnectionStatusChip
> = {
  DRAFT: {
    label: "Being set up",
    tone: "neutral",
    title: "Your identity provider is registered. No domain is claimed yet.",
  },
  CLAIMED: {
    label: "Domain claimed",
    tone: "neutral",
    title: "You have claimed a domain. It has not been approved yet.",
  },
  APPROVED: {
    label: "Domain approved",
    tone: "neutral",
    title: "Your domain is approved. Prove it to start routing sign-ins.",
  },
  REJECTED: {
    label: "Domain not approved",
    tone: "bad",
    title: "That claim was not approved. You can claim the domain again.",
  },
  DISCARDED: {
    label: "Withdrawn",
    tone: "neutral",
    title: "This connection was withdrawn before it carried anybody.",
  },
  VERIFICATION_PENDING: {
    label: "Waiting for your record",
    tone: "warning",
    title:
      "Publish the record we gave you on your domain, and ask us to check for it.",
  },
  VERIFIED: {
    label: "Ready to turn on",
    tone: "neutral",
    title: "Your domain is proved. Turn the connection on when you are ready.",
    // The one state on the journey that is waiting on the person reading it.
    shimmer: true,
  },
  SUSPENDED: {
    label: "Paused",
    tone: "bad",
    title:
      "Sign-in through this connection is switched off. Talk to us to turn it back on.",
  },
  TEARDOWN_PENDING: {
    label: "Being removed",
    tone: "warning",
    title:
      "This connection is on its way out. Sign-ins move back to the way they worked before it.",
  },
  TORN_DOWN: {
    label: "Removed",
    tone: "neutral",
    title: "This connection no longer carries anybody.",
  },
};
