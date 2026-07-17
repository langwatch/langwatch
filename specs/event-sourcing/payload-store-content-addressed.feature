# See dev/docs/adr/029-groupqueue-content-addressed-payload-store.md for the architectural rationale.
Feature: GroupQueue content-addressed tiered payload store
  As the LangWatch event-sourcing queue absorbing fan-out from a single event
  I want one event's shared payload stored once by content hash and referenced
  by every job it fans out to, across three size tiers, reclaimed eagerly when
  the last referencing job finishes
  So that a dozen-way fan-out costs one payload copy instead of a dozen, the
  queue survives a weekend outage without accumulating days of dead payloads,
  and offload is decided by size alone, not by command-vs-job provenance.

  # Builds on ADR-026's GQ1 envelope (specs/event-sourcing/payload-envelope.feature).
  # Supersedes ADR-026's blob-lifecycle scenarios: random blob ids become content
  # hashes; best-effort-delete + 7-day pure-backstop TTL becomes holder-set eager
  # reclaim + 4-day refreshed backstop. The GQ1 envelope/header/routing/two-phase
  # rollout decisions carry forward unchanged.
  #
  # TWO mechanisms share the word "dedup" — this spec keeps them apart:
  #   - content-addressed sharing / "store-once" (THIS feature): one shared
  #     payload component (event, fold state) is stored ONCE by content hash;
  #     every job carrying identical bytes references that single copy.
  #   - dedup-id squash (NOT this feature): STAGE_LUA collapses same-identity
  #     staged jobs into one HSET field — owned by
  #     specs/traces/record-span-gq-dedup.feature, configured per
  #     specs/event-sourcing/deduplication-strategy.feature. This feature only
  #     COMPOSES with it: a squashed slot releases its hold on its blob.
  #   The holder-set members are the per-slot `stagedJobId`s of
  #   record-span-gq-dedup.feature.
  #
  # Decision (ADR-029):
  #   - Three tiers by serialized size: inline ≤4 KiB · redis 4 KiB–256 KiB ·
  #     s3 >256 KiB (boundary aligned with ADR-022 COMMAND_INLINE_THRESHOLD).
  #   - Blob id = SHA-256(canonical bytes) truncated to 128 bits, base64url.
  #     Identical bytes -> identical key -> one stored copy. PUTs idempotent.
  #     Keys are namespaced by projectId (the tenant id; tenantId === projectId),
  #     minting the stored_objects layout s3://{bucket}/{projectId}/<hash> so
  #     tenants never share a blob and purge is delete-by-prefix.
  #   - Flat jobs: the fan-out producer hoists the shared component (event, fold
  #     state) out of every job; each job carries refs, not the payload. Decode
  #     resolves refs before the handler, which is unchanged.
  #   - Holder set {queue}:gq:blobholders:<hash> tracks references by stagedJobId;
  #     SADD at stage, SREM at every retire edge, atomic with the job-entry write.
  #     Empties -> eager UNLINK (redis) / reclaim-list sweep (s3).
  #   - 4-day TTL on blob + holder set, refreshed on access, is the orphan
  #     backstop only. A missing blob completes the slot without the handler
  #     (recoverable via replay) — a fail-safe, never a wedge.
  #
  # RESOLVED (ADR-029): the s3/file tier reuses the stored-objects StorageDriver/
  # StorageRegistry/URI minting (specs/features/scenarios/externalize-event-byte-content.feature)
  # — the driver only, NOT StoredObjectsService (whose no-GC lifecycle would
  # clash with holder-set reclaim). The redis tier stays the queue's own store.
  #
  # Related ADRs: 029 (this), 026 (envelope, extended), 022 (event_log SoT — its
  # BlobStore is event_log-centric, NOT reused here), 024 (CH cold-path tiering —
  # distinct subsystem), 007 (event sourcing). Object store reused from
  # src/server/stored-objects/. Pause: specs/queue-pausing/queue-pausing.feature.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades
    # Steady-state baseline. The Track 4 rollout scenarios are the only ones that
    # override the write state (to "not enabled"), and they do so scenario-locally.
    And envelope v2 writes are enabled for the deployment
    And the inline tier ceiling is configured at 4 KiB
    And the S3 tier threshold is configured at 256 KiB
    And the blob TTL backstop is configured at 4 days

  # ===========================================================================
  # Track 1 — content-addressed tiers
  # ===========================================================================

  @integration @track1 @unimplemented
  Scenario: A sub-threshold payload stays inline in the envelope body
    When a job whose shared payload is under the inline ceiling is staged
    Then the stored value is an envelope carrying the payload in its body
    And no standalone blob key is written for it

  @integration @track1 @unimplemented
  Scenario: A mid-size payload offloads to a content-addressed Redis blob
    When a job whose shared payload is between the inline ceiling and the S3 threshold is staged
    Then the body is stored under a standalone Redis key named by its content hash
    And the queued value is a flat envelope referencing the blob by tier "redis" and hash
    And the handler receives the payload intact

  @integration @track1 @unimplemented
  Scenario: A very large payload offloads to S3 through the reused object store
    When a job whose shared payload exceeds the S3 threshold is staged
    Then the body is stored via the stored-objects registry under an s3:// key namespaced by projectId and content hash
    And the queued value is a flat envelope referencing the blob by tier "s3" and hash
    And the handler receives the payload intact

  @unit @track1 @unimplemented
  Scenario: The same bytes always produce the same blob key
    Given two payloads with byte-identical canonical serializations
    When each is offloaded
    Then both resolve to the same content-addressed key
    And the second offload is a no-op PUT over the existing key

  # ===========================================================================
  # Track 2 — flat jobs and content-addressed sharing (store-once)
  # ===========================================================================

  @integration @track2 @unimplemented
  # The headline waste: one event today fans out to a dozen-plus jobs each
  # carrying its own copy. After this change the event is stored once.
  Scenario: One event fanned out to many jobs stores the shared payload once
    Given an event is dispatched to a fold projection, several map projections, and a chain of reactors
    When the resulting jobs are staged
    Then the shared event is stored under a single content-addressed key
    And every staged job references that key rather than embedding the event
    And the number of stored copies of the event is one regardless of the fan-out width

  @integration @track2 @unimplemented
  Scenario: A reactor job references the shared event and its fold state separately
    Given a fold whose reactors each receive the event and the same fold state
    When the reactor jobs are staged
    Then the event is stored once under its content hash
    And the fold state is stored once under its content hash
    And each reactor job carries a ref to the event and a ref to the fold state
    And the handler still receives a payload deep-equal to { event, foldState }

  @integration @track2 @unimplemented
  # The producer-hoist payoff: a projection job (event sent spread) and a reactor
  # job (event nested in { event, foldState }) carry DIFFERENT shapes, yet the
  # event is lifted at the fan-out point before the shapes diverge, so both
  # reference one stored copy. A per-job encoder hoist would miss this.
  Scenario: A projection and a reactor for the same event share one stored event
    Given one event dispatched to both a map projection and a reactor
    When their jobs are staged
    Then the event is hoisted at the fan-out point and stored once
    And the projection job and the reactor job both reference that single copy
    And the event was serialized and stored once for the fan-out, not once per job

  @integration @track2 @unimplemented
  Scenario: A flat job round-trips its payload through ref resolution unchanged
    When a flat job is staged and later dispatched to its handler
    Then the handler receives a payload deep-equal to the one that was sent
    And a resolve-adapter reconstituted the components before the handler ran
    And the wire value carried refs in place of the shared components

  @unit @track2 @unimplemented
  # Multi-tenancy guard: blob keys are namespaced by projectId (the tenant id;
  # tenantId === projectId), matching the stored_objects layout
  # s3://{bucket}/{projectId}/<hash>. Isolation is structural — in the key path —
  # not incidental to content. This also makes a project purge a delete-by-prefix
  # over .../{projectId}/* (driven by the platform's project-delete cascade); the
  # redis tier needs none, its 4-day TTL clears once the project's jobs drain.
  Scenario: Blob keys are namespaced by tenant so tenants never share a blob
    Given two tenants whose jobs carry byte-identical user content
    When each payload is offloaded
    Then each blob key is namespaced under its own projectId
    And the two payloads resolve to different keys
    And neither tenant's job can resolve the other tenant's blob

  # ===========================================================================
  # Track 3 — lease reclaim (ADR-046; supersedes the holder-set track)
  # ===========================================================================
  # ADR-029's holder-set reference counting was removed by ADR-046 after the
  # 2026-07-09 phantom-hold leak. Blobs are no longer reclaimed eagerly: they
  # carry a lease TTL refreshed on access, extended by the block/DLQ paths,
  # and the s3 tier is reclaimed by the bucket lifecycle rule. The detailed
  # lease contract lives in payload-store-blob-lease.feature; the scenarios
  # kept here are the sharing guarantees that survive the rewrite.

  @integration @track3
  Scenario: A shared blob outlives every job that references it
    Given a blob referenced by three staged jobs
    When all three jobs complete
    Then the blob remains present until its lease elapses
    And no completion deletes it out from under a concurrent same-content stage

  @integration @track3
  Scenario: A retry re-stage keeps the same content-addressed blob alive
    Given an offloaded job that fails with a retryable error
    When it is re-staged with its attempt counter incremented
    Then the re-staged value references the same content-addressed blob
    And the retry re-encode re-puts the blob, renewing its lease

  @integration @track3
  Scenario: A blob survives dispatch for the whole handler run
    Given an offloaded job referencing a blob
    When the job is dispatched to the worker
    Then the blob is still present while the handler runs
    And the dispatch read renewed its lease

  @integration @track3
  Scenario: An access refreshes a blob's lease so a long-dwell job keeps its payload
    Given an offloaded job held in a retry-backoff chain
    When the job is dispatched after a delay shorter than the lease
    Then the dispatch refreshes the blob's lease
    And the blob is still present for the handler

  @integration @track3
  Scenario: An orphaned blob expires via its lease
    Given a blob written to Redis whose staging never completed
    And no job references it
    When the lease elapses without any access refreshing it
    Then the blob is reclaimed

  @integration @track3
  # Carried forward from payload-envelope.feature's GQ1 fail-safe "A missing
  # blob does not wedge the group"; the guarantee survives the rewrite intact.
  Scenario: A missing blob completes the slot without wedging the group
    Given a flat job whose referenced blob has expired or been deleted
    When dispatch delivers it to the worker
    Then the job is completed without invoking the handler
    And the group continues processing subsequent jobs
    And the drop is counted and logged with the envelope descriptor

  # ===========================================================================
  # Track 4 — backward compatibility (write gate removed by ADR-046)
  # ===========================================================================

  @integration @track4
  Scenario: Legacy GQ1 and bare-JSON jobs staged before the deploy still process
    Given a job staged as a GQ1 envelope or plain JSON by a previous deployment
    When dispatch evaluates and delivers that job
    Then the handler receives the original payload
    And no content-addressed blob is required to resolve it

  @integration @track4
  Scenario: Writes are unconditionally GQ2 envelopes
    Given any job staged by the current release
    Then the stored value is a GQ2 envelope
    And a missing tiered store or tenant downgrades to an inline GQ2 body, loudly, never to GQ1
