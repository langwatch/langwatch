# Operations the branch documents but does not serve

Captured 2026-09-12, BEFORE the OpenAPI document was refrozen. Read
`dev/docs/plans/handover-2026-09-12-apidiff-2.md` for how each class arose
and where the wiring is recoverable from (commit b383462d96).

**Why this file exists.** `openapi-check` only reports an operation as
removed while the frozen document still claims it. The moment the document
is regenerated from the declarations, these stop being reported and the gap
becomes invisible to every automated check in the repository. This list is
the record. `apidiff` re-finds them independently, because it probes the
union of the operations BOTH instances document and main still documents
these — but that needs a running apidiff, which is what the refreeze buys.

Totals: 373 removals reported, 83 after excluding dated/latest
variants, and 70 that no declaration publishes at any spelling. The other 13
are the same operation published at its `/api/v1` twin, which is the branch's
deliberate canonicalization and not a gap.

## scim (15)

    DELETE /api/scim/v2/Groups/{id}
    DELETE /api/scim/v2/Users/{id}
    GET /api/scim/v2/Groups
    GET /api/scim/v2/Groups/{id}
    GET /api/scim/v2/ResourceTypes
    GET /api/scim/v2/Schemas
    GET /api/scim/v2/ServiceProviderConfig
    GET /api/scim/v2/Users
    GET /api/scim/v2/Users/{id}
    PATCH /api/scim/v2/Groups/{id}
    PATCH /api/scim/v2/Users/{id}
    POST /api/scim/v2/Groups
    POST /api/scim/v2/Users
    PUT /api/scim/v2/Groups/{id}
    PUT /api/scim/v2/Users/{id}

## teams (9)

    DELETE /api/v1/teams/{id}
    DELETE /api/v1/teams/{id}/members/{userId}
    GET /api/v1/teams
    GET /api/v1/teams/{id}
    GET /api/v1/teams/{id}/members
    GET /api/v1/teams/{id}/projects
    PATCH /api/v1/teams/{id}
    POST /api/v1/teams
    POST /api/v1/teams/{id}/members

## gateway (8)

    DELETE /api/gateway/v1/providers/{id}
    GET /api/gateway/v1/end-users/{id}/spend
    GET /api/gateway/v1/providers
    GET /api/gateway/v1/spend-events
    GET /api/gateway/v1/spend-summaries
    PATCH /api/gateway/v1/providers/{id}
    POST /api/gateway/v1/providers
    POST /api/gateway/v1/spend-events/replay

## dataset (8)

    DELETE /api/v1/dataset/direct-upload/{datasetId}
    PATCH /api/v1/dataset/{slugOrId}/records/{recordId}
    POST /api/v1/dataset/direct-upload
    POST /api/v1/dataset/direct-upload/{datasetId}/finalize
    POST /api/v1/dataset/direct-upload/{datasetId}/retry
    POST /api/v1/dataset/upload
    POST /api/v1/dataset/{slugOrId}/upload
    PUT /api/v1/dataset/direct-upload/staging/{uploadId}

## experiments (8)

    GET /api/v1/experiments/runs
    GET /api/v1/experiments/runs/{runId}
    GET /api/v1/experiments/runs/{runId}/results
    GET /api/v1/experiments/{slug}/versions
    GET /api/v1/experiments/{slug}/workbench-state
    POST /api/v1/experiments/{slug}/run
    POST /api/v1/experiments/{slug}/versions/{version}/restore
    PUT /api/v1/experiments/{slug}/workbench-state

## governance (7)

    DELETE /api/v1/governance/ingestion-templates/{id}
    GET /api/v1/governance/ingestion-templates
    GET /api/v1/governance/ingestion-templates/admin
    GET /api/v1/governance/ingestion-templates/{id}
    PATCH /api/v1/governance/ingestion-templates/{id}/ottl-rules
    POST /api/v1/governance/ingestion-templates
    POST /api/v1/governance/ingestion-templates/clone

## projects (5)

    DELETE /api/projects/{id}
    GET /api/projects/{id}
    GET /api/projects/{id}/api-key
    PATCH /api/projects/{id}
    POST /api/projects/{id}/regenerate-api-key

## scenario-events (3)

    DELETE /api/v1/scenario-events
    POST /api/v1/scenario-events
    POST /api/v1/scenario-events/browser-tab

## scim-tokens (3)

    DELETE /api/v1/scim-tokens/{id}
    GET /api/v1/scim-tokens
    POST /api/v1/scim-tokens

## traces (3)

    GET /api/v1/traces/{traceId}
    PATCH /api/v1/traces/{traceId}/metadata
    POST /api/v1/traces/search

## events (1)

    POST /api/v1/events/track

