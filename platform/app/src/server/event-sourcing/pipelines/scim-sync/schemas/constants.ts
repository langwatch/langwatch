/**
 * The directory-sync pipeline's framework identity (D08). One aggregate per
 * connection's sync (`aggregateId = scimSyncId`, which IS the connection id —
 * see `scimSyncIdFor`), and the ORGANIZATION is the tenant
 * (`tenantId = organizationId`), so an organization's connections and their
 * syncs read out of one tenant scan.
 *
 * Its own pipeline rather than a second aggregate inside `sso-connections`,
 * for the reason that file gives: a pipeline declares ONE aggregate type and
 * the event store refuses at append any event whose type differs (#7406). A
 * connection and its directory sync have different lifecycles — a connection
 * outlives every token minted for it — so they are two aggregates. What they
 * share is the identity vocabulary: the events are `lw.identity.scim_*` and
 * the facts are `@langwatch/identity`'s.
 *
 * The SCIM request path never READS these. It answers from Postgres exactly
 * as it does today; this history is what makes a push attributable and a
 * failure visible.
 */
export const SCIM_SYNC_PIPELINE_NAME = "scim-sync" as const;
export const SCIM_SYNC_AGGREGATE_TYPE = "scim_sync" as const;
