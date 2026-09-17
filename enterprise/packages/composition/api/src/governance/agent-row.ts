// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

export type AgentSource = "custom" | "databricks" | "copilot_studio";

export interface GovernanceAgentRow {
  id: string;
  name: string;
  environment: string | null;
  owner: string | null;
  models: readonly string[];
  source: AgentSource;
  costUsd30d: number | null;
  requests30d: number | null;
  lastActiveMinutesAgo: number | null;
  health: unknown | null;
  registeredDaysAgo: number | null;
}
