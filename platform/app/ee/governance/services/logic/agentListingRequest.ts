// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which of an organization's sources an on-demand agent listing can be asked
 * of, and what asking them looks like as commands.
 *
 * Pure. No prisma, no clock, no id minting: the service supplies the tenant,
 * the moment and the request id, so a test can pin the exact payloads that
 * reach the pipeline without a database or a stubbed random.
 *
 * ONE ASK PER SOURCE, not one per organization. The aggregate is the source
 * (`aggregateId = sourceId`), so an organization-wide ask would have nowhere
 * to land: two sources are two streams, two leases and two provider calls, and
 * one of them refusing has to be recordable without losing the other's answer.
 *
 * ONE REQUEST ID PER PRESS, shared by every command the press produces. The
 * idempotency key is derived from the source and the request together, so a
 * shared id still gives each source its own key, and the outcomes of one press
 * stay recognisable as one press for whatever reads them later.
 */

// From the leaf, not from `agentDiscovery.service`. That import pulled both
// pullers and the credential seam into a module whose header promises none of
// it, and every consumer of this logic carried them.
import { sourceTypeCanListAgents } from "./agentListingProviders";

/** The columns of an `IngestionSource` this decision actually reads. */
export interface ListableSourceRecord {
  id: string;
  name: string;
  sourceType: string;
}

/** The payload `requestAgentsListing` takes, envelope included. */
export interface AgentListingRequestCommand {
  tenantId: string;
  occurredAt: number;
  sourceId: string;
  requestId: string;
}

/**
 * The sources worth asking.
 *
 * Filtered before the ask rather than at the provider, because asking a source
 * whose provider has no listing at all spends a pipeline lease to record a
 * `not_configured` refusal that was knowable without it. The screen needs the
 * same set to say which providers it is speaking for, so this is one function
 * and not two that can disagree.
 *
 * The predicate is imported rather than restated. Two copies of "which
 * providers can list agents" is how the button and the sentence beside it end
 * up describing different sets.
 */
export function listableAgentSources<T extends ListableSourceRecord>(
  sources: readonly T[],
): T[] {
  return sources.filter((source) => sourceTypeCanListAgents(source.sourceType));
}

/**
 * One press, turned into the commands it dispatches.
 *
 * Takes the already-filtered sources: a caller that has to name the providers
 * on screen has run {@link listableAgentSources} anyway, and filtering twice
 * is how the count in the toast stops matching the count that was asked.
 */
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
