/**
 * The join-request pipeline's framework identity (ADR-117, D12). One
 * aggregate per request (`aggregateId = joinRequestId`), and the ORGANIZATION
 * is the tenant (`tenantId = organizationId`) — the people who READ a request
 * are its admins, so an organization's requests are one tenant's history and
 * support can read them in a single tenant scan.
 *
 * Why this is its own pipeline rather than a second aggregate inside the
 * identity one: a pipeline declares ONE aggregate type and the event store
 * refuses at append any event whose type differs from it (#7406). The
 * identity pipeline declares `user_identity` and is tenanted by the USER; a
 * join request is neither. So the aggregate lives beside it and keeps the
 * identity vocabulary — the events are `lw.identity.join_*`, the facts are
 * `@langwatch/identity`'s, the guards are `@langwatch/identity-server`'s.
 * What is separate is the storage partition, which is the only thing the
 * framework was ever going to let us share.
 *
 * Membership is never written from this pipeline. An approval dispatches an
 * attach on the grants ledger, exactly as accepting an invitation does, and
 * the ledger fact carries `source: "join-request"` as its provenance.
 */
export const JOIN_REQUEST_PIPELINE_NAME = "join-requests" as const;
export const JOIN_REQUEST_AGGREGATE_TYPE = "join_request" as const;
