// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { DATABRICKS_GENIE_ADAPTER_ID } from "@langwatch/enterprise-governance-contract";

import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "./dataverse-environment-service.rules.ts";

/** The source types whose provider can be asked for its agents; the dispatch is keyed by this list. */
const AGENT_LISTING_SOURCE_TYPES = [
  DATABRICKS_GENIE_ADAPTER_ID,
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
] as const;

export type AgentListingSourceType = (typeof AGENT_LISTING_SOURCE_TYPES)[number];

const AGENT_LISTABLE: ReadonlySet<string> = new Set(AGENT_LISTING_SOURCE_TYPES);

/** Any other source type is a refusal, so a screen can say "this one cannot" without failing. */
export function sourceTypeCanListAgents(sourceType: string): boolean {
  return AGENT_LISTABLE.has(sourceType);
}
