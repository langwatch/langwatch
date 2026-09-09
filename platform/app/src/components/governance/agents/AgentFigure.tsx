import { Text, VStack } from "@chakra-ui/react";
import numeral from "numeral";

import { Tooltip } from "~/components/ui/tooltip";

import { formatLastActive, type GovernanceAgentRow } from "./agentRows";

/**
 * One figure an agent row carries, and the single way a missing one is drawn.
 *
 * Both layouts render through here. The card stacks a label over the value and
 * the table puts the value in a fixed column, but the formatting and the dash
 * are the same code, so the two cannot disagree about what an agent spent or
 * about the sentence behind an absent figure. This is the arrangement the
 * inventory catalog arrived at for the same reason — see `ToolCardFigure` —
 * where a card and a table also show the same numbers.
 *
 * A figure we do not have is an em dash with a reason on hover, never a zero.
 * `$0.00` is a measurement — it says the agent ran and spent nothing — and an
 * agent that has never been called has not earned that claim.
 *
 * Spec: specs/ai-governance/dashboard/agents-page.feature
 */

/** What a dash means when nothing more specific is known about the gap. */
export const AGENT_UNMEASURED = "The platform has not measured this yet.";

/** What a dash means where the agent has registered and never been called. */
export const AGENT_NEVER_RUN = "This agent has registered but has never run.";

/**
 * Why an agent's spend is missing, which is not the same sentence for every
 * source. Both layouts ask this rather than each carrying the branch, so a
 * reader who switches between them is never given two reasons for one gap.
 */
export function agentCostMissingReason(agent: GovernanceAgentRow): string {
  return agent.source === "copilot_studio"
    ? "Dollar cost per agent needs billing data and a supported calculation."
    : AGENT_UNMEASURED;
}

/** United States dollars over the last thirty days, or `null` if unmeasured. */
export function formatAgentCost(agent: GovernanceAgentRow): string | null {
  return agent.costUsd30d === null
    ? null
    : numeral(agent.costUsd30d).format("$0,0.00");
}

/** Calls over the last thirty days, or `null` if unmeasured. */
export function formatAgentRequests(agent: GovernanceAgentRow): string | null {
  return agent.requests30d === null
    ? null
    : numeral(agent.requests30d).format("0,0");
}

/** When the agent last did anything, in words, or `null` if it never has. */
export function formatAgentLastActive(
  agent: GovernanceAgentRow,
): string | null {
  return formatLastActive(agent.lastActiveMinutesAgo);
}

/**
 * A value, or the dash that stands in for one.
 *
 * The reason is carried on `aria-label` as well as in the tooltip, so a reader
 * who never hovers — and a reader using a screen reader — still gets the
 * sentence rather than a bare dash.
 */
export function AgentValue({
  value,
  missingReason = AGENT_UNMEASURED,
}: {
  value: string | null;
  missingReason?: string;
}) {
  if (value === null) {
    return (
      <Tooltip content={missingReason}>
        <Text textStyle="sm" color="fg.muted" aria-label={missingReason}>
          —
        </Text>
      </Tooltip>
    );
  }
  return (
    <Text textStyle="sm" fontWeight="medium">
      {value}
    </Text>
  );
}

/**
 * A labelled figure, for the card. The table labels its figures once in the
 * column header instead, so it renders `AgentValue` on its own.
 */
export function AgentFigure({
  label,
  value,
  missingReason,
}: {
  label: string;
  value: string | null;
  missingReason?: string;
}) {
  return (
    <VStack align="start" gap={0.5}>
      <Text textStyle="xs" color="fg.muted">
        {label}
      </Text>
      <AgentValue value={value} missingReason={missingReason} />
    </VStack>
  );
}
