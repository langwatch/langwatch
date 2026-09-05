// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Who a payload claims to have been ingested by, enforced on the way in.
 *
 * These endpoints authenticate with an ingestion-source secret, so there is no
 * API-key row to attribute the payload to and the attribute always ends up
 * absent. It is still ENFORCED rather than left alone: a payload-supplied copy
 * has to be dropped, because redaction exempts that name from the secret-name
 * deny-list. The rule itself is the trace receiver's own, so the process hands
 * it in rather than this package restating it.
 */
export abstract class GovernanceIngestKeyProvenancePort {
  abstract dropOnTraceRequest(request: unknown): void;

  abstract dropOnLogRequest(request: unknown): void;

  abstract dropOnMetricRequest(request: unknown): void;
}
