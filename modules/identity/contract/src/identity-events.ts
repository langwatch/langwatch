/**
 * The identity pipeline's framework identity (ADR-101, D01). One aggregate
 * per user (`aggregateId = userId`, and `tenantId = userId` — the user is
 * the tenant of their own identity history, which makes erasure and support
 * lookup a single tenant scan, ADR-029 §4). The sign-in hot path never reads
 * these — it reads the Postgres `Identifier` projection the fold maintains.
 *
 * The event and command TYPE strings are this package's own vocabulary and
 * live beside their payloads; what lives here is what only the framework
 * needs: the pipeline's name and its aggregate type — the storage partition
 * key every event stamps and the store validates (#7406).
 *
 * The wire schemas that extend these payloads with the framework envelope
 * (`EventSchema.extend`) live in `@langwatch/identity-server` instead, next
 * to the pipeline definitions that build on them — this package stays free
 * of the `@langwatch/eventing` framework so the frontend can import it
 * verbatim.
 */
export const IDENTITY_PIPELINE_NAME = "identity" as const;
export const USER_IDENTITY_AGGREGATE_TYPE = "user_identity" as const;
