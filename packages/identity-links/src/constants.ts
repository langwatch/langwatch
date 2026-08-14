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
 * Which declared kind each provider's ledger `actor_id` lives in.
 *
 * The pullers pick the JSONPath; this says which id NAMESPACE that path lands
 * in, so the report can build a login ref from a bare `ActorUserId` column
 * without re-deriving the adapter's intent. Kept beside
 * `EXTERNAL_KINDS_BY_PROVIDER` because a kind here that is not declared there
 * is a join that silently never matches — the test pins exactly that.
 *
 * Sources of each entry, from the frozen puller configs:
 * - `anthropic` — `$.actor.id`, Anthropic's member id namespace.
 * - `microsoft` — `$.initiatedBy.user.id`, the Entra objectId (the one
 *   immutable id of the three; `upn` moves when a person is renamed).
 * - `databricks` — the workspace `user_id`, immutable per ADR-094 Assumptions.
 *
 * `openai` is absent on purpose and that is a captain default, not an
 * oversight: its puller declares no `actor_id` because OpenAI has no declared
 * id namespace here yet, so its rows carry no typed id and land unattributed
 * until the provider joins the vocabulary. A report must handle the absence
 * gracefully rather than treat it as a bug.
 */
export const ACTOR_ID_KIND_BY_PROVIDER = {
  databricks: "numeric_id",
  anthropic: "member_id",
  microsoft: "entra_object_id",
} as const satisfies Partial<Record<LinkProvider, string>>;

/**
 * Report bucket names (ADR-094 Constants, "Bucket names"). Never merged:
 * `unattributed` is fixable by linking, `unattributable` can never resolve,
 * and collapsing them tells an admin to go and create a link that cannot
 * exist. `attributed` includes "former member (erased)" (Decision 9).
 */
export const REPORT_BUCKETS = [
  "attributed",
  "unattributed",
  "unattributable",
] as const;
export type ReportBucket = (typeof REPORT_BUCKETS)[number];

/**
 * Display copy for a login whose timeline resolves to a person we have been
 * asked to forget. It sits INSIDE the attributed bucket (Decision 9): the
 * timeline still resolves, just to an erased person rather than a name, and
 * moving that spend to "unattributed" would change published totals.
 */
export const ERASED_PERSON_DISPLAY_NAME = "former member (erased)" as const;

/**
 * Freshness copy for providers that restate their own numbers after the fact
 * (ADR-094 Constants, "Freshness copy"). Shown so a reader knows the tail of
 * the window is still moving, rather than discovering it when the number
 * changes under them.
 */
export const REVISING_PROVIDER_FRESHNESS_COPY =
  "complete through watermark − 30 days" as const;

/**
 * Notice raised when a link row appended AFTER a report export carries an
 * `effectiveFrom` that reaches back into that export's period (Decision 3).
 * Backdating is how corrections work and is allowed — it is never silent.
 */
export const BACKDATED_ATTRIBUTION_NOTICE =
  "attribution changed for already-reported periods" as const;

/**
 * Kinds whose value names the person in email form — the ones erasure swaps
 * for the org-scoped keyed-hash token (ADR-094 Decision 9). Microsoft's `upn`
 * is included by captain decision (recorded as an amendment on Decision 9):
 * it is email-shaped and names the person, so it must not survive erasure.
 */
export const EMAIL_EXTERNAL_KINDS = ["email", "upn"] as const;
export type EmailExternalKind = (typeof EMAIL_EXTERNAL_KINDS)[number];

export const isEmailKind = (
  externalKind: string,
): externalKind is EmailExternalKind =>
  (EMAIL_EXTERNAL_KINDS as readonly string[]).includes(externalKind);

/**
 * The email-shaped kinds THIS provider declares — Microsoft spells it `upn`,
 * Anthropic and Databricks spell it `email`. Derived rather than declared a
 * second time: a provider gaining an email-shaped kind must not need an edit
 * in two places to start matching.
 */
export const emailKindsForProvider = (provider: string): readonly string[] =>
  (
    (EXTERNAL_KINDS_BY_PROVIDER[provider as LinkProvider] ??
      []) as readonly string[]
  ).filter(isEmailKind);

/**
 * Canonical bytes for an email-shaped login id: trimmed, lowercased, UTF-8
 * (ADR-094 Constants, "Erased-email token"). Providers disagree on case, and
 * two spellings of one address must never become two timeline entries — nor
 * two different erasure tokens.
 *
 * Every place that STORES or COMPARES an email-kind `externalId` runs the value
 * through here: the admin link surface on create, erasure when it derives the
 * token, and the report when it builds email login refs from the ledger. A
 * caller that skips it silently stops matching.
 */
export const canonicalizeEmailLike = (value: string): string =>
  value.trim().toLowerCase();

/**
 * Canonicalize only when the kind is email-shaped — non-email ids (numeric ids,
 * object ids, member ids) are opaque and case-significant, so lowercasing them
 * would be a corruption rather than a normalization.
 */
export const canonicalizeExternalId = ({
  externalKind,
  externalId,
}: {
  externalKind: string;
  externalId: string;
}): string =>
  isEmailKind(externalKind) ? canonicalizeEmailLike(externalId) : externalId;

/**
 * Link ordering: `effectiveFrom DESC, seq DESC` — one deterministic winner
 * per login id per moment. `seq` is a database-assigned tie-break only,
 * never business meaning. Encoded in resolution.ts; named here so the
 * constant is quotable.
 */
export const LINK_ORDERING = "effectiveFrom DESC, seq DESC" as const;
