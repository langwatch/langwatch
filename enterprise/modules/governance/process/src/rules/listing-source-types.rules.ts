// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import {
  ANTHROPIC_ADMIN_ADAPTER_ID,
  OPENAI_ADMIN_ADAPTER_ID,
} from "@langwatch/enterprise-governance-contract";

import { DATABRICKS_GENIE_ADAPTER_ID } from "../services/pull-destination.service.ts";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "./dataverse-environment-service.rules.ts";

/** The source types whose provider can be asked for its agents; the dispatch is keyed by this list. */
export const AGENT_LISTING_SOURCE_TYPES = [
  DATABRICKS_GENIE_ADAPTER_ID,
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
] as const;

export type AgentListingSourceType = (typeof AGENT_LISTING_SOURCE_TYPES)[number];

const AGENT_LISTABLE: ReadonlySet<string> = new Set(AGENT_LISTING_SOURCE_TYPES);

const PEOPLE_LISTABLE: ReadonlySet<string> = new Set([
  ANTHROPIC_ADMIN_ADAPTER_ID,
  OPENAI_ADMIN_ADAPTER_ID,
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
  DATABRICKS_GENIE_ADAPTER_ID,
]);

/** Any other source type is a refusal, so a screen can say "this one cannot" without failing. */
export function sourceTypeCanListAgents(sourceType: string): boolean {
  return AGENT_LISTABLE.has(sourceType);
}

export function sourceTypeCanListPeople(sourceType: string): boolean {
  return PEOPLE_LISTABLE.has(sourceType);
}
