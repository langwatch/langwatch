import type { GovernanceAgentRow } from "@langwatch/enterprise-governance-contract";
import type { ReactNode } from "react";

/** What the page adds to one agent's row or card, decided outside this feature. */
export type AgentRowExtras = (agent: GovernanceAgentRow) => {
  status?: ReactNode;
  actions?: ReactNode;
};
