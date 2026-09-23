import { Text, VStack } from "@chakra-ui/react";
import { Tooltip } from "@langwatch/design-system/tooltip";
import numeral from "numeral";

import { formatLastActive, type GovernanceAgentRow } from "./agentRows";

/**
 * One figure of an agent row and the single way a missing one is drawn, shared by card and table
 * (like the inventory's `ToolCardFigure`). Missing is a dash with a reason, never `$0.00`.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */

/** What a dash means when nothing more specific is known about the gap. */
export const AGENT_UNMEASURED = "The platform has not measured this yet.";

/** What a dash means where the agent has registered and never been called. */
export const AGENT_NEVER_RUN = "This agent has registered but has never run.";

/** What a dash means in the environment column. */
export const AGENT_ENVIRONMENT_UNDECLARED =
  "This agent has not declared which environment it runs in.";

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
  return agent.costUsd30d === null ? null : numeral(agent.costUsd30d).format("$0,0.00");
}

/** Calls over the last thirty days, or `null` if unmeasured. */
export function formatAgentRequests(agent: GovernanceAgentRow): string | null {
  return agent.requests30d === null ? null : numeral(agent.requests30d).format("0,0");
}

/** When the agent last did anything, in words, or `null` if it never has. */
export function formatAgentLastActive(agent: GovernanceAgentRow): string | null {
  return formatLastActive(agent.lastActiveMinutesAgo);
}

/**
 * A value, or the dash that stands in for one. The reason is carried on `aria-label` as well as in
 * the tooltip, so a reader who never hovers — and a reader using a screen reader — still gets the
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
 * Where the agent runs, drawn here so card and table agree on what no declared environment looks
 * like. Muted: context for the name, not a compared figure.
 */
export function AgentEnvironment({ environment }: { environment: string | null }) {
  if (environment === null) {
    return <AgentValue value={null} missingReason={AGENT_ENVIRONMENT_UNDECLARED} />;
  }
  return (
    <Text textStyle="sm" color="fg.muted">
      {environment}
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
