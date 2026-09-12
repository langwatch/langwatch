// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Which providers can be asked to list their agents.
 *
 * A LEAF, and that is the whole reason it exists. `agentListingRequest.ts`
 * needs this one question answered and used to get it by importing
 * `agentDiscovery.service`, which pulls both pullers, the credential seam and
 * everything they import into a module whose header promises no prisma and no
 * clock. The header and the import graph disagreed, and every consumer of that
 * logic module paid for the adapters.
 *
 * Only the two adapter-id constants come in here, which is what the sibling
 * logic modules already do (`agentInventoryRows.ts` imports the same two).
 *
 * ONE LIST, not two. This used to be a set here and a chain of `if` blocks in
 * the service, both encoding "which providers can list agents". A third
 * provider added to one and not the other is silent in both directions: added
 * to the set alone, every ask returns `not_configured` from a screen that just
 * offered the button; added to the dispatch alone, the screen never offers it.
 * `AgentListingSourceType` is exported so the service's lister table is typed
 * against exactly these ids and fails to compile if the two drift.
 */

import { DATABRICKS_GENIE_ADAPTER_ID } from "../../../../../../../specs/ai-governance/puller-framework/databricks-genie.feature";
import { COPILOT_STUDIO_DATAVERSE_ADAPTER_ID } from "../../../../../../modules/governance/server/src/services/dataverse-environment.service.ts";

export const AGENT_LISTING_SOURCE_TYPES = [
  DATABRICKS_GENIE_ADAPTER_ID,
  COPILOT_STUDIO_DATAVERSE_ADAPTER_ID,
] as const;

/** One of the provider ids above, as a type the lister table can be keyed by. */
export type AgentListingSourceType =
  (typeof AGENT_LISTING_SOURCE_TYPES)[number];

const LISTABLE: ReadonlySet<string> = new Set(AGENT_LISTING_SOURCE_TYPES);

/**
 * Whether this source type can list agents at all.
 *
 * Every other source type is a refusal rather than an error, and deliberately:
 * a screen that offers this for one source in a list must be able to say "this
 * one cannot" without the request failing. `not_configured` is the honest
 * reason — the source holds no credential this listing could use, because there
 * is no listing for its provider at all.
 *
 * A `Set` and not an object literal: `sourceType` arrives from a database
 * column, and `Object.prototype` would answer for `constructor` and `toString`.
 */
export function sourceTypeCanListAgents(sourceType: string): boolean {
  return LISTABLE.has(sourceType);
}
