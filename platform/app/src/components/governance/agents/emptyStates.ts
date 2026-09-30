import type { AgentsListingRefusalCause } from "@ee/governance/services/pullers/agentsListingOutcome";
import { Bot, SearchX, TriangleAlert } from "lucide-react";
import type { ComponentType } from "react";

import { spokenList } from "./agentSummary";

/**
 * The words this page shows when it has nothing to show, held apart from the
 * thing that renders them. FIVE states, because there are five ways for this
 * page to be empty and none of them may borrow another's sentences: nothing is
 * connected, providers are connected and none has been asked, every provider
 * answered and holds none, a provider refused to answer, and everything is
 * filtered out of view.
 *
 * The pair that matters most is the third and the fourth. A provider answering
 * "none" and a provider refusing to answer both leave a page with no agents on
 * it, and they ask opposite things of the reader: one means nothing is wrong,
 * the other means somebody has to go and fix a credential. One sentence for
 * both left an admin believing they had no agents while a credential quietly
 * failed, which is the defect these words exist to end.
 *
 * The shared governance empty state that renders them lives at
 * ~/components/governance/empty. It was built once, by the inventory page,
 * because the same requirement landed on both of us and two independently
 * invented empty states is how this codebase ended up with five separate sample
 * badges. Its shape comes from the Langy empty state
 * (src/features/langy/components/EmptyState.tsx): a glyph, a serif headline, a
 * sentence, and something to press. The shape is what we share. Langy's words
 * are Langy's alone, and these are the Agents page's.
 *
 * They live here, ahead of that component, so the copy can be read and argued
 * with now and so dropping it in later is a prop bag rather than a rewrite.
 *
 * Every one of these carries an action, because an empty state that only
 * explains itself leaves the reader exactly where they were. On this page the
 * honest action is almost always registering an agent: ADR-128 makes an agent
 * register itself from the process that runs it, so there is nothing else a
 * person can do from here to make agents appear.
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
   * How heavily that action is drawn.
   *
   * The house header button is for an action that creates something of the
   * organization's own, which is the same rule the page headers follow;
   * anything that merely changes what is shown, or that repeats a control the
   * header already draws ghost, is quieter than it. Declared here, beside the
   * words, because weight is part of a state's voice and the call site is
   * where the next state added is the one that forgets it. Left undeclared,
   * "Clear filters" drew as the same orange solid as "Register agent" and
   * threw away the distinction this file exists to make.
   *
   * Rule: specs/ai-governance/dashboard/governance-ui-controls.feature,
   * "An empty pane's action is weighted by what it does".
   */
  emphasis: "primary" | "secondary";
}

/**
 * Nothing is connected, so nothing can be listed.
 *
 * The headline says the state and the sentence says the reason, because "no
 * agents" on its own reads as a fault. It is not one: no agent has registered
 * yet, and the copy points at the one move that changes that.
 *
 * This is now the branch for an organization with NO provider that can list
 * agents. Registering really is the only move such a reader has. Where a
 * provider is connected, {@link agentsUnlistedCopy} says so instead, because
 * telling that reader to go write registration code would be the page failing
 * to notice what they already have.
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
 * Providers that can list agents are connected, and NOBODY HAS ASKED THEM YET.
 *
 * A THIRD nothing, and now the narrowest of the three. It used to cover every
 * organization with a provider connected, because the page could not tell an
 * empty tenant from a refused credential and had to write one sentence that
 * would be true either way. The read exists now — `syncSources` carries the
 * last listing outcome per source — so this state has handed both of those
 * cases to {@link agentsListedEmptyCopy} and {@link agentsRefusedCopy} and
 * kept only what it was always describing honestly: no listing has been
 * recorded, so nothing is known about what these providers hold.
 *
 * It also covers the mixed case where SOME provider has answered and another
 * has never been asked. "Nothing has been listed from them yet" stays true of
 * the set, where the stronger claim that the organization holds no agents
 * would not be: an unasked provider could be running a dozen.
 *
 * It still claims nothing about the tenant. That constraint outlived the gap
 * that created it — an unasked provider is not an empty one, and saying so
 * would be the same collapse the three-outcome listing was built to prevent.
 *
 * A factory rather than a constant, because the sentence names the providers
 * and a fixed string would either omit them or invent them.
 *
 * THE LAST SENTENCE CHANGES WITH THE GRANT. A reader who cannot press the
 * control is not told to press it. The control itself is drawn for them,
 * disabled and carrying its own reason, but a paragraph ending "Ask now"
 * beside a button they cannot use reads as the page not knowing who it is
 * talking to.
 * Rule: specs/ai-governance/dashboard/governance-ui-controls.feature,
 * "An empty pane explains itself rather than sitting blank".
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
      canAsk
        ? `Ask now to find out ${holds}.`
        : `Only an administrator can ask ${them} ${holds}.`
    }`,
    actionLabel: "Sync agents",
    // Ghost, matching the header's own sync control rather than the create
    // action beside it. Asking a provider what it already has creates nothing
    // of the organization's own — that is why `GovernanceSyncButton` draws
    // ghost in the header — and an empty pane repeating the header's action
    // has to look like the header's action. Drawn primary, this pane put the
    // outlined house button on a sync while the header put it on Register
    // agent, so the same press had two weights on one screen.
    emphasis: "secondary",
  };
}

/**
 * Every connected provider answered, and between them they hold no agents.
 *
 * THE ONLY STATE ON THIS PAGE ALLOWED TO SAY THE ORGANIZATION HAS NONE, and
 * it may say it only because every provider that could have agents was asked
 * and each one returned an empty list. An empty list is a real answer from a
 * working credential — the log records it as `listed` with a count of zero,
 * deliberately, so that it can never be confused with a refusal.
 *
 * The gate is EVERY provider, not any. One provider answering "none" while
 * another has never been asked does not make the organization empty, so that
 * case stays with {@link agentsUnlistedCopy} and its weaker sentence. The page
 * owns that gate, because only the page can see the whole set.
 *
 * The action is registering rather than asking again. There is nothing left to
 * ask: the providers have answered, and ADR-128 makes an agent register itself
 * from the process that runs it, so writing that registration is the one move
 * that changes this screen. That is also why the weight is primary here and
 * secondary on the two states whose action is a sync — this one creates
 * something of the organization's own.
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
 * A provider was asked and would not answer.
 *
 * THE STATE THIS WHOLE FEATURE EXISTS FOR. A refusal and an empty tenant look
 * identical on a page that shows no agents, and they demand opposite things of
 * the reader: an empty tenant means nothing is wrong, a refusal means somebody
 * has to go fix something before this page can be trusted at all. Showing one
 * set of words for both left an admin believing they had no agents while a
 * credential quietly failed.
 *
 * IT NEVER CLAIMS A COUNT. Not "no agents", not "some agents" — the provider
 * refused, so the honest statement is that this page cannot say what it holds.
 * Any agent behind that provider is missing from the list above and there is
 * no number to put on it.
 *
 * AND IT NEVER SHOWS THE STATUS. The run-status row keeps the provider's HTTP
 * status for an operator reading a support ticket; a tenant admin shown "403"
 * learns nothing they can act on. The server has already narrowed it to the
 * two things a person does differently — fix an access problem, or wait and
 * ask again — and only that lands here.
 *   `access`      — a credential, a permission or a connection's configuration
 *                   is wrong. Asking again changes nothing until it is fixed.
 *   `unreachable` — the provider did not answer or answered badly. Asking
 *                   again later is the whole remedy, and telling this reader
 *                   to audit their permissions would send them to look for a
 *                   fault that is not there.
 *
 * THE LAST SENTENCE CHANGES WITH THE GRANT, as in {@link agentsUnlistedCopy}:
 * a reader who cannot press the sync control is told who can, not told to
 * press it. The action stays the sync in both arms — it is the header's own
 * control repeated, so it is drawn ghost — and it is the right press once the
 * access problem is fixed, which is why the access arm names the fix first and
 * the ask second.
 */
/**
 * One voice per cause, as data rather than as nested conditionals.
 *
 * The two arms differ in three places at once — the headline, the verb in the
 * middle of the sentence, and the whole remedy — and expressing that as
 * ternaries put the two halves of each arm in different parts of the function,
 * where a later edit could easily give the unreachable arm the access arm's
 * instruction. Keyed by cause, each arm reads as one thing.
 *
 * `Record` rather than a partial map, so a third cause added to
 * `AgentsListingRefusalCause` is a compile error here rather than an
 * `undefined` rendering as a blank pane.
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
      canAsk
        ? "Ask again in a moment."
        : "Only an administrator can ask again.",
  },
  incomplete: {
    headlineOne: "A provider had more agents than we could read",
    headlineMany: "Providers had more agents than we could read",
    // Count-neutral, like the other two verbs: one `verb` serves both the
    // singular and plural sentences, so "holds" would misagree the moment two
    // providers hit the bound in the same run.
    verb: "still had agents to list when we stopped reading",
    // The only remedy that does not depend on `canAsk`, and deliberately so:
    // the limit is ours, so holding the grant that makes Sync pressable buys
    // this reader nothing. Offering the button to one reader and withholding
    // it from another would imply the press does something. It does not: the
    // next walk reads the same pages and stops in the same place.
    //
    // It also promises no mechanism. There is no self-serve way to raise the
    // bound today, and inventing one here would send somebody looking through
    // settings for a control that does not exist.
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
 * Agents exist; the reader has filtered them all out of view.
 *
 * A different nothing from the one above, and it must not borrow its copy:
 * telling someone to register an agent when they have ten and a narrow filter
 * is the page failing to understand its own state.
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
