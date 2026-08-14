// ADR-094 Constants. The database columns stay String (same posture as
// IngestionSource.sourceType): adapters add providers and kinds here, in
// code, without a migration.

/** How a link row came to exist. */
export const LINK_SOURCES = [
  "manual",
  "external_id",
  "email_suggestion_accepted",
  "offboarding",
] as const;
export type LinkSource = (typeof LINK_SOURCES)[number];

/**
 * Which id namespaces each provider exposes for the same person. The kind is
 * part of every lookup so a Databricks numeric id can never meet an Anthropic
 * email in one bucket (ADR-094 Decision 1); each adapter writes exactly one
 * declared kind per namespace.
 */
export const EXTERNAL_KINDS_BY_PROVIDER = {
  databricks: ["numeric_id", "scim_external_id", "email"],
  anthropic: ["member_id", "service_account", "api_key", "email"],
  microsoft: ["entra_object_id", "upn", "puid"],
} as const;
export type LinkProvider = keyof typeof EXTERNAL_KINDS_BY_PROVIDER;
export type ExternalKind =
  (typeof EXTERNAL_KINDS_BY_PROVIDER)[LinkProvider][number];

/**
 * Kinds whose value names the person in email form — the ones erasure swaps
 * for the org-scoped keyed-hash token (ADR-094 Decision 9). Microsoft's `upn`
 * is included by captain decision (recorded as an amendment on Decision 9):
 * it is email-shaped and names the person, so it must not survive erasure.
 */
export const EMAIL_EXTERNAL_KINDS: readonly string[] = ["email", "upn"];

export const isEmailKind = (externalKind: string): boolean =>
  EMAIL_EXTERNAL_KINDS.includes(externalKind);

/**
 * Link ordering: `effectiveFrom DESC, seq DESC` — one deterministic winner
 * per login id per moment. `seq` is a database-assigned tie-break only,
 * never business meaning. Encoded in resolution.ts; named here so the
 * constant is quotable.
 */
export const LINK_ORDERING = "effectiveFrom DESC, seq DESC" as const;
