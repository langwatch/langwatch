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
   * One case is: a connection whose domain is proved, which has not been
   * turned on, AND which has nothing else outstanding. Everything else is
   * settled, waiting on somebody else, or waiting on a step further up the
   * journey, and all of it drew in the same grey - so the one step that had
   * just become possible looked like the four that were merely finished.
   *
   * The last condition is not a detail. A proved domain with a test sign-in
   * still to do is waiting on the reader too, but on a DIFFERENT control,
   * which carries its own "Do this next"; shimmering here as well would
   * point at the one button the page is still refusing.
   *
   * The chip carries the same words either way - the sweep adds attention,
   * never meaning - and nothing moves for a reader who asked for less motion.
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
 * Where the connection stands.
 *
 * ONE FACT, NOT TWO. This used to answer "is it on" and "is anybody being
 * sent to it" separately, because a second switch decided the latter — so a
 * live connection could truthfully read "On, not routing yet", which is a
 * chip nobody could act on: the control that would have changed it was not
 * the administrator's. Turning the connection on is now the whole decision,
 * so being on and carrying sign-in are the same fact and the chip says it
 * once.
 */
export function connectionStatusChipFor({
  state,
  goLiveBlockedBecause,
}: {
  state: SsoConnectionLifecycleState;
  /**
   * Why turning the connection on is not available yet, in the words
   * `setupProgress` gives it: `null` when it IS available, and `undefined`
   * from a caller that cannot see the four preconditions.
   *
   * A PROVED DOMAIN IS NOT READINESS, which is the disagreement this
   * argument settles. Turning a connection on also needs a sign-in that
   * worked, somebody who can still get in without it, and a decision about
   * who it admits - none of which the lifecycle state can see. So the chip
   * said "Ready to turn on" and shimmered for attention while step six of
   * the same screen said "Waiting" and listed what was still outstanding.
   *
   * Only `null` promises readiness. `undefined` falls to the true, narrower
   * statement rather than the optimistic one, so a caller that cannot see
   * the preconditions is less specific instead of wrong.
   */
  goLiveBlockedBecause?: string | null;
}): ConnectionStatusChip {
  if (state === "ACTIVE") {
    return {
      label: "Active",
      tone: "good",
      title:
        "People with an address at your proved domains sign in through your identity provider.",
    };
  }
  if (state === "VERIFIED") return verifiedChip({ goLiveBlockedBecause });
  return STEADY_STATES[state];
}

/**
 * A proved domain, which is either the last step or the fifth of six.
 *
 * Its own state cannot tell the two apart, so this takes the answer from the
 * caller and says the smaller true thing when there is no answer to take.
 */
function verifiedChip({
  goLiveBlockedBecause,
}: {
  goLiveBlockedBecause: string | null | undefined;
}): ConnectionStatusChip {
  if (goLiveBlockedBecause === null) {
    return {
      label: "Ready to turn on",
      tone: "neutral",
      title:
        "Your domain is proved. Turn the connection on when you are ready.",
      // The one state on the journey that is waiting on the person reading
      // it - and only once nothing else is.
      shimmer: true,
    };
  }
  return {
    label: "Domain proved",
    tone: "neutral",
    // The reason, when the caller knows it, is the same sentence step six
    // gives, so the two places a reader might look agree word for word.
    title:
      goLiveBlockedBecause ??
      "Your domain is proved. Carry on setting it up to turn the connection on.",
  };
}

/** Every state a connection can rest in, other than the live one. */
const STEADY_STATES: Record<
  Exclude<SsoConnectionLifecycleState, "ACTIVE" | "VERIFIED">,
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
