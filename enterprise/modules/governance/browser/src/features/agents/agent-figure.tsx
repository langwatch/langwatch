import { Text, VStack } from "@langwatch/design-system/primitives";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { type GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import numeral from "numeral";

import { formatLastActive } from "./agent-rows";

/**
 * One figure of an agent row and the single way a missing one is drawn, shared by card and table
 * (like the inventory's `ToolCardFigure`). Missing is "No data" with a reason, never `$0.00`.
 * @see specs/ai-governance/dashboard/agents-page.feature
 */

/** What "No data" means when nothing more specific is known about the gap. */
export const AGENT_UNMEASURED = "The platform has not measured this yet.";

/** What "No data" means where the agent has registered and never been called. */
export const AGENT_NEVER_RUN = "This agent has registered but has never run.";

/** What "No data" means in the environment column. */
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
 * A value, or a quiet "No data" drawn like the inventory's `ToolCardFigure`. The reason is carried
 * on `aria-label` as well as in the tooltip, so a reader who never hovers still gets the sentence.
 */
export function AgentValue({
  label,
  value,
  missingReason = AGENT_UNMEASURED,
}: {
  label: string;
  value: string | null;
  missingReason?: string;
}) {
  if (value === null) {
    return (
      <Tooltip content={missingReason} showArrow positioning={{ placement: "top" }}>
        <Text
          textStyle="sm"
          color="fg.subtle"
          cursor="help"
          aria-label={`${label} not measured. ${missingReason}`}
        >
          No data
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
    return (
      <AgentValue label="Environment" value={null} missingReason={AGENT_ENVIRONMENT_UNDECLARED} />
    );
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
      <AgentValue label={label} value={value} missingReason={missingReason} />
    </VStack>
  );
}
