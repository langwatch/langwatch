import { Bot, Boxes, SearchX } from "lucide-react";
import type { ComponentType } from "react";

/**
 * The words this page shows when it has nothing to show, held apart from the
 * thing that renders them.
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
 * The tab the owner named as the live example of a weak empty state.
 *
 * An application is not a thing anyone creates on this page — it is the group
 * an agent already belongs to — so the action is still registering an agent.
 * Offering "Create application" would be a button that cannot work.
 */
export const APPLICATIONS_EMPTY_COPY: GovernanceEmptyStateCopy = {
  icon: Boxes,
  headline: "No applications yet",
  description:
    "An application is the set of agents one team ships together. Register an agent and the application it belongs to appears here.",
  actionLabel: "Register agent",
  emphasis: "primary",
};

/**
 * Agents exist; the reader has filtered them all out of view.
 *
 * A different nothing from the two above, and it must not borrow their copy:
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
