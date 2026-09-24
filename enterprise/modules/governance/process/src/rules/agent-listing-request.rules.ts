// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { sourceTypeCanListAgents } from "./listing-source-types.rules.ts";

export interface ListableSourceRecord {
  id: string;
  name: string;
  sourceType: string;
}

/** One ask of one source, filed under the organization's governance project. */
export interface AgentListingRequestCommand {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  requestId: string;
}

/** The sources whose provider can list agents; none rather than every source when there are none. */
export function listableAgentSources<T extends ListableSourceRecord>(sources: readonly T[]): T[] {
  return sources.filter((source) => sourceTypeCanListAgents(source.sourceType));
}

/** One press becomes one command per source, all under one request id. */
export function agentListingRequests({
  sources,
  tenantId,
  requestId,
  now,
}: {
  sources: readonly ListableSourceRecord[];
  tenantId: string;
  requestId: string;
  now: number;
}): AgentListingRequestCommand[] {
  return sources.map((source) => ({
    tenantId,
    occurredAt: now,
    sourceId: source.id,
    requestId,
  }));
}
