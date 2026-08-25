/**
 * The join-request pipeline's framework identity (ADR-117, D12). One
 * aggregate per request (`aggregateId = joinRequestId`), and the ORGANIZATION
 * is the tenant (`tenantId = organizationId`) — the people who READ a request
 * are its admins, so an organization's requests are one tenant's history and
 * support can read them in a single tenant scan.
 *
 * Why this is its own pipeline rather than a second aggregate inside the
 * identity one: the KEY, not the entity kind.
 *
 * Distinct entity kinds can share an aggregate type perfectly well —
 * `trace-processing` stamps `aggregateType: "trace"` on seven different
 * command families — but only when they share a key, because the aggregate id
 * is what the queue shards on and what a fold loads by. A join request cannot:
 * it is keyed by `joinRequestId` and tenanted by the organization, while the
 * identity pipeline is keyed by user and tenanted by the user. Folding both
 * through one pipeline would put two unrelated keyspaces in one lane and one
 * tenant's requests under another tenant's stream.
 *
 * So the aggregate lives beside it and keeps the identity vocabulary — the
 * events are `lw.identity.join_*`, the facts are `@langwatch/identity`'s, the
 * guards are `@langwatch/identity-server`'s. What is separate is the storage
 * partition and the lane, which is exactly what the key decides.
 *
 * Membership is never written from this pipeline. An approval dispatches an
 * attach on the grants ledger, exactly as accepting an invitation does, and
 * the ledger fact carries `source: "join-request"` as its provenance.
 */
export const JOIN_REQUEST_PIPELINE_NAME = "join-requests" as const;
export const JOIN_REQUEST_AGGREGATE_TYPE = "join_request" as const;
