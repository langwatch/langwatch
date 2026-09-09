import { Bot, SearchX } from "lucide-react";
import type { ComponentType } from "react";

import { spokenList } from "./agentSummary";

/**
 * The words this page shows when it has nothing to show, held apart from the
 * thing that renders them. Two states, because there are two ways for this
 * page to be empty and they must never borrow each other's sentences: nothing
 * has registered, and everything is filtered out of view.
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
   * Solid is for an action that creates something of the organization's own,
   * which is the same rule the page headers follow; anything that merely
   * changes what is shown is quieter than solid. Declared here, beside the
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
 * Providers that can list agents are connected, and the page holds none.
 *
 * A THIRD nothing, and the reason it earns its own words is that the page
 * cannot currently tell the two possibilities apart. A provider that answered
 * "this tenant has no agents" and a provider that refused to answer are
 * different facts, one about the tenant and one about the credential, and this
 * page has no read that distinguishes them: the outcome events exist in the
 * log and no projection folds them (see `ingestionPullRunStatus`). So the copy
 * says only what is known — these providers are connected, and nothing has
 * been listed from them — and offers the ask rather than asserting the tenant
 * is empty. Claiming emptiness on a refusal would be exactly the collapse the
 * three-outcome listing was built to prevent.
 *
 * When a read for the last outcome exists, this state splits: a listed-empty
 * arm may say the tenant has none, and a refused arm names the credential and
 * what to do about it. Neither may be written before the page can tell which
 * it is looking at.
 *
 * A factory rather than a constant, because the sentence names the providers
 * and a fixed string would either omit them or invent them.
 */
export function agentsUnlistedCopy(
  providerNames: readonly string[],
): GovernanceEmptyStateCopy {
  return {
    icon: Bot,
    headline: "No agents to show yet",
    description: `${spokenList([...providerNames])} ${providerNames.length === 1 ? "is" : "are"} connected, and no agent has been listed from ${providerNames.length === 1 ? "it" : "them"} yet. Nothing has registered itself here either. Ask now to find out what they hold.`,
    actionLabel: "Sync agents",
    // Asking is how this organization's own agents get here, which is the same
    // weight registering one carries on the state above.
    emphasis: "primary",
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
