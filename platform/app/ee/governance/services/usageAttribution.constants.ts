// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import type { LinkProvider } from "@langwatch/identity-links";

/**
 * Which link-list provider each ingestion source type belongs to.
 *
 * Two vocabularies meet here and neither is going to change to suit the other:
 * `IngestionSource.sourceType` names the CONNECTOR a customer configured
 * (`claude_compliance`, `copilot_studio`, …), while ADR-094's `provider` names
 * the ID NAMESPACE a login lives in (`anthropic`, `microsoft`, `databricks`).
 * Several connectors can share one namespace — Anthropic's compliance API and
 * the Cowork integration both hand back Anthropic member ids — so the mapping
 * is many-to-one and has to be written down rather than derived.
 *
 * A source type absent from this table contributes NO login refs, and its rows
 * land in the unattributed bucket. That is the correct outcome, not a gap:
 * - `openai_compliance` has no declared id namespace in ADR-094's Constants
 *   and its puller writes no `actor_id` on purpose, so there is nothing to
 *   join on. Joining on an email alone is the email-recycling guess the ADR
 *   refuses by name.
 * - `otel_generic` / `workato` / `s3_custom` / `http_custom` are shapes, not
 *   providers: the customer decides what an actor id means in them, so we
 *   cannot declare a namespace on their behalf.
 */
export const LINK_PROVIDER_BY_SOURCE_TYPE: Record<string, LinkProvider> = {
  claude_compliance: "anthropic",
  claude_cowork: "anthropic",
  claude_code: "anthropic",
  copilot_studio: "microsoft",
  databricks_genie: "databricks",
};

/**
 * Source types whose provider restates its own numbers after the fact, so the
 * tail of any window is still moving when it is read (ADR-088 restatement
 * path, #6978). A report over such a source carries the freshness copy;
 * everything else needs none, and saying it anyway would train readers to
 * ignore it.
 */
export const REVISING_SOURCE_TYPES: readonly string[] = ["claude_compliance"];

export const linkProviderForSourceType = (
  sourceType: string,
): LinkProvider | null => LINK_PROVIDER_BY_SOURCE_TYPE[sourceType] ?? null;
