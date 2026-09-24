// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What a connection is called and where it stands, in a customer's words. The
 * aggregate's vocabulary is `VERIFICATION_PENDING` and ten more like it, and a
 * chip carrying that asks an administrator to learn our state machine. Total
 * over every state on purpose: a table with a hole in it renders the hole.
 */
import type { SsoConnectionLifecycleState, SsoConnectionType } from "@langwatch/identity-contract";

import { updateChipFor, type SsoMigrationPhase } from "./migration-route.ts";

export type ConnectionChipTone = "neutral" | "good" | "warning" | "bad";

export interface ConnectionStatusChip {
  label: string;
  tone: ConnectionChipTone;
  /** The longer explanation, on hover. */
  title: string;
  /**
   * Whether this state waits on the READER rather than on a system: a proved
   * domain, not yet turned on, with nothing else outstanding. The words are
   * the same either way — the sweep adds attention, never meaning.
   */
  shimmer?: boolean;
}

/**
 * The connection named by the protocol it speaks. "Single sign-on" alone tells
 * an administrator nothing the page has not; the protocol is what they
 * configured at the other end, and how they recognize their own connection.
 */
export function connectionProtocolName(type: SsoConnectionType): string {
  return type === "saml" ? "SAML single sign-on" : "OpenID Connect single sign-on";
}

/**
 * Where the connection stands. ONE FACT, NOT TWO: turning the connection on is
 * the whole decision, so being on and carrying sign-in are the same fact and
 * the chip says it once.
 */
export function connectionStatusChipFor({
  state,
  goLiveBlockedBecause,
}: {
  state: SsoConnectionLifecycleState;
  /**
   * Why turning it on is not available yet, in `setupProgress`'s words: `null`
   * when it IS available, `undefined` from a caller that cannot see the four
   * preconditions. Only `null` promises readiness, so a caller that cannot see
   * them is less specific instead of wrong.
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
 * A proved domain, which is either the last step or the fifth of six. Its own
 * state cannot tell the two apart, so this takes the answer from the caller
 * and says the smaller true thing when there is no answer to take.
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
      title: "Your domain is proved. Turn the connection on when you are ready.",
      shimmer: true,
    };
  }

  return {
    label: "Domain proved",
    tone: "neutral",
    // The reason, when the caller knows it, is step six's own sentence, so
    // the two places a reader might look agree word for word.
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
    title: "Publish the record we gave you on your domain, and ask us to check for it.",
  },
  SUSPENDED: {
    label: "Paused",
    tone: "bad",
    title: "Sign-in through this connection is switched off. Talk to us to turn it back on.",
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

export interface PreviewCopy {
  chip: ConnectionStatusChip;
  action: string;
  stepLabel: string;
  step: string;
}

/**
 * The preview card's words. An update in flight outranks the lifecycle state:
 * a replacement sits in DRAFT while the whole company signs in through the
 * connection it replaces, so the card says which step of the update it is on.
 */
export function previewCopyFor({
  state,
  goLiveBlockedBecause,
  updatePhase,
}: {
  state: SsoConnectionLifecycleState | null;
  goLiveBlockedBecause: string | null;
  updatePhase: SsoMigrationPhase | null;
}): PreviewCopy {
  if (updatePhase) {
    const chip = updateChipFor(updatePhase);
    return { chip, action: "Where it stands", stepLabel: "Next step", step: chip.title };
  }
  if (state === null) {
    return {
      chip: {
        label: "Not set up",
        tone: "neutral",
        title: "No identity provider is connected to this organization.",
      },
      action: "Set it up",
      stepLabel: "First step",
      step: "Telling us about your identity provider.",
    };
  }

  return {
    chip: connectionStatusChipFor({ state, goLiveBlockedBecause }),
    action: "Carry on setting it up",
    stepLabel: "Next step",
    step: "Carry on where you left off.",
  };
}
