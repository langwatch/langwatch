import type { AgentsListingRefusalCause } from "@langwatch/enterprise-governance-contract";
import { Bot, SearchX, TriangleAlert } from "lucide-react";
import type { ComponentType } from "react";

import { spokenList } from "./agentSummary";

/**
 * The page's empty-state words, apart from the renderer: five states, each with its own sentences
 * and an action. Answered-none and refused must never share words: one is fine, the other needs a
 * fix.
 */
export interface GovernanceEmptyStateCopy {
  /** A lucide glyph. Structural so any icon library can satisfy it. */
  icon: ComponentType<{ size?: string | number }>;
  headline: string;
  /** One sentence. Two if the second earns itself. */
  description: string;
  /** The handler belongs to the caller, which is the only thing that has one. */
  actionLabel: string;
  /**
   * How heavily the action is drawn: primary only for creating something of the organization's own;
   * changing the view or repeating a header control is quieter. Declared beside the words so no
   * state forgets it.
   * @see specs/ai-governance/dashboard/governance-ui-controls.feature
   */
  emphasis: "primary" | "secondary";
}

/**
 * Nothing is connected, so nothing can be listed: no agent has registered yet, and registering is
 * the only move. Where a provider is connected, {@link agentsUnlistedCopy} speaks instead.
 */
export const AGENTS_EMPTY_COPY: GovernanceEmptyStateCopy = {
  icon: Bot,
  headline: "No agents registered yet",
  description:
    "An agent registers itself from the process that runs it. Connect one and it appears here with its environment, its models and what it has been spending.",
  actionLabel: "Register agent",
  // Registering creates something of the organization's own.
  emphasis: "primary",
};

/**
 * Providers that can list agents are connected and none has been asked (or only some answered), so
 * nothing is claimed about the tenant. Names the providers; the last sentence follows the grant.
 * @see specs/ai-governance/dashboard/governance-ui-controls.feature
 */
export function agentsUnlistedCopy({
  providerNames,
  canAsk,
}: {
  providerNames: readonly string[];
  /** Whether this reader holds the grant that makes the sync control pressable. */
  canAsk: boolean;
}): GovernanceEmptyStateCopy {
  const one = providerNames.length === 1;
  const them = one ? "it" : "them";
  const holds = one ? "what it holds" : "what they hold";
  return {
    icon: Bot,
    headline: "No agents to show yet",
    description: `${spokenList([...providerNames])} ${one ? "is" : "are"} connected, and no agent has been listed from ${them} yet. Nothing has registered itself here either. ${
      canAsk ? `Ask now to find out ${holds}.` : `Only an administrator can ask ${them} ${holds}.`
    }`,
    actionLabel: "Sync agents",
    // Ghost, like the header's sync control: asking creates nothing of the organization's own, and
    // the same press must not carry two weights on one screen.
    emphasis: "secondary",
  };
}

/**
 * Every connected provider answered with an empty list: the only state allowed to say the
 * organization has none. The action is registering (ADR-128), so it is primary.
 */
export function agentsListedEmptyCopy({
  providerNames,
}: {
  providerNames: readonly string[];
}): GovernanceEmptyStateCopy {
  const one = providerNames.length === 1;
  return {
    icon: Bot,
    headline: "No agents yet",
    description: `${spokenList([...providerNames])} ${one ? "was" : "were"} asked and ${one ? "holds" : "hold"} no agents, and nothing has registered itself here from code. An agent registers itself from the process that runs it.`,
    actionLabel: "Register agent",
    emphasis: "primary",
  };
}

/**
 * A provider was asked and refused: never claims a count and never shows the HTTP status. `access`
 * means fix a credential first; `unreachable` means ask again later. The last sentence follows the
 * grant.
 */

/**
 * One voice per cause, as data: each arm's headline, verb and remedy read together. A `Record`, so
 * a new `AgentsListingRefusalCause` is a compile error, not a blank pane.
 */
const REFUSAL_VOICE: Record<
  AgentsListingRefusalCause,
  {
    headlineOne: string;
    headlineMany: string;
    /** What the providers did, dropped into the middle of the sentence. */
    verb: string;
    remedy: (args: { canAsk: boolean; connection: string }) => string;
  }
> = {
  access: {
    headlineOne: "A provider refused to answer",
    headlineMany: "Providers refused to answer",
    verb: "refused to answer",
    remedy: ({ canAsk, connection }) =>
      canAsk
        ? `Check ${connection} credentials and permissions, then ask again.`
        : `An administrator needs to check ${connection} credentials and permissions.`,
  },
  unreachable: {
    headlineOne: "A provider did not answer",
    headlineMany: "Providers did not answer",
    verb: "did not answer",
    // No connection to check: nothing about the credential is known to be
    // wrong, and naming one would send this reader hunting a fault that is
    // not there.
    remedy: ({ canAsk }) =>
      canAsk ? "Ask again in a moment." : "Only an administrator can ask again.",
  },
  incomplete: {
    headlineOne: "A provider had more agents than we could read",
    headlineMany: "Providers had more agents than we could read",
    // Count-neutral, like the other two verbs: one `verb` serves both the
    // singular and plural sentences, so "holds" would misagree the moment two
    // providers hit the bound in the same run.
    verb: "still had agents to list when we stopped reading",
    // The one remedy independent of `canAsk`: the limit is ours, so syncing again changes nothing.
    // It promises no mechanism, since no self-serve way to raise the bound exists.
    remedy: () =>
      "Nothing is wrong with that connection and asking again will not help. This is a limit on our side; contact support if you need the full inventory.",
  },
};

export function agentsRefusedCopy({
  providerNames,
  cause,
  canAsk,
}: {
  /** Only the providers that refused. Naming one that answered would blame it. */
  providerNames: readonly string[];
  cause: AgentsListingRefusalCause;
  /** Whether this reader holds the grant that makes the sync control pressable. */
  canAsk: boolean;
}): GovernanceEmptyStateCopy {
  const one = providerNames.length === 1;
  const voice = REFUSAL_VOICE[cause];
  const refusal = `${spokenList([...providerNames])} ${voice.verb}, so this page cannot say ${one ? "what it holds" : "what they hold"}.`;
  const remedy = voice.remedy({
    canAsk,
    connection: one ? "that connection's" : "those connections'",
  });
  return {
    icon: TriangleAlert,
    headline: one ? voice.headlineOne : voice.headlineMany,
    description: `${refusal} ${remedy}`,
    actionLabel: "Sync agents",
    // Ghost, for the reason `agentsUnlistedCopy` gives: this is the header's
    // own sync control repeated in the pane, and the same press must not have
    // two weights on one screen.
    emphasis: "secondary",
  };
}

/**
 * Agents exist; the reader has filtered them all out of view. A different nothing from the one
 * above, and it must not borrow its copy: telling someone to register an agent when they have ten
 * and a narrow filter is the page failing to understand its own state.
 */
export const NO_MATCHING_AGENTS_COPY: GovernanceEmptyStateCopy = {
  icon: SearchX,
  headline: "No agent matches these filters",
  description:
    "Every agent in this organization is filtered out by the source or ownership you picked.",
  actionLabel: "Clear filters",
  // Quieter, and the one case on this page that is. Clearing a filter creates
  // nothing: it is the way back from a narrow view, not a call to action, and
  // drawing it like one would make this state indistinguishable from the two
  // above at exactly the moment the difference matters.
  emphasis: "secondary",
};
