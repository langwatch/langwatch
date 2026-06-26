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
  # reclaim + 3-day refreshed backstop. The GQ1 envelope/header/routing/two-phase
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
  #   - 3-day TTL on blob + holder set, refreshed on access, is the orphan
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
    And the blob TTL backstop is configured at 3 days

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
  # redis tier needs none, its 3-day TTL clears once the project's jobs drain.
  Scenario: Blob keys are namespaced by tenant so tenants never share a blob
    Given two tenants whose jobs carry byte-identical user content
    When each payload is offloaded
    Then each blob key is namespaced under its own projectId
    And the two payloads resolve to different keys
    And neither tenant's job can resolve the other tenant's blob

  # ===========================================================================
  # Track 3 — holder-set reclaim and TTL backstop
  # ===========================================================================

  @integration @track3 @unimplemented
  Scenario: A shared blob survives until its last referencing job completes
    Given a blob referenced by three staged jobs
    When two of the jobs complete
    Then the blob is still present
    When the third job completes
    Then the blob is reclaimed
    And its holder set is removed

  @integration @track3 @unimplemented
  # Composes the holder set with the dedup-id squash owned by
  # record-span-gq-dedup.feature. SUPERSEDES payload-envelope.feature's GQ1
  # scenario "Offloaded blobs displaced by a dedup squash are reclaimed":
  # under GQ1 every job owned a private random-id blob, so the squash deleted
  # the displaced blob unconditionally. Under v2 the blob may be shared, so the
  # squashed slot only releases its hold — the blob goes iff no slot still holds it.
  Scenario: A dedup squash releases its hold without dropping a still-referenced blob
    Given two staged jobs referencing the same content-addressed blob
    When a later job with the same dedup id squashes one of them in place
    Then the squashed slot releases its hold on the blob
    And the blob remains because the surviving slot still holds it

  @integration @track3 @unimplemented
  Scenario: A retry re-stage keeps the same content-addressed blob alive
    Given an offloaded job that fails with a retryable error
    When it is re-staged with its attempt counter incremented
    Then the re-staged slot holds the same content-addressed blob
    And the retry re-encodes to the same hash, so the hold is never released-then-needed
    And the blob is not reclaimed across the retry

  @integration @track3 @unimplemented
  # Dispatch HDELs the job value out of the group hash and hands it to the worker
  # in memory, so the blob must outlive dispatch; the hold releases only when the
  # slot terminally retires (complete / exhaust / squash / decode-fail).
  Scenario: A blob survives dispatch and is released only at terminal retirement
    Given an offloaded job referencing a blob
    When the job is dispatched to the worker
    Then the blob is still present while the handler runs
    And the hold is released only when the job terminally retires

  @integration @track3 @unimplemented
  # The one TOCTOU the holder set alone doesn't close: the release (SREM +
  # reclaim-if-empty) must be atomic against a concurrent re-stage of the same
  # content, or the last completion could delete a blob a new job just took.
  Scenario: A completion racing a re-stage of the same content does not delete the live blob
    Given a blob whose last holder is completing
    And a new job referencing the same content is staged concurrently
    When the release runs
    Then the blob is retained because the new job holds it
    And no job is left referencing a deleted blob

  @integration @track3 @unimplemented
  Scenario: An S3-tier blob is reclaimed through the sweeper when its holders empty
    Given an S3-tier blob referenced by a single staged job
    When that last referencing job completes
    Then the blob's key is enqueued for best-effort sweep deletion
    And the object-store lifecycle rule reclaims it if the sweep is missed

  @integration @track3 @unimplemented
  Scenario: An access refreshes a blob's TTL so a long-dwell job keeps its payload
    Given an offloaded job held in a retry-backoff chain
    When the job is dispatched after a delay shorter than the TTL
    Then the dispatch refreshes the blob's TTL
    And the blob is still present for the handler

  @integration @track3 @unimplemented
  # Crash between the client PUT and the Lua stage leaves a blob with an empty
  # holder set; nothing eager reclaims it, so the backstop must.
  Scenario: An orphaned blob with no holders expires via its TTL backstop
    Given a blob written to Redis whose staging never completed
    And no job references it
    When the TTL backstop elapses without any access refreshing it
    Then the blob is reclaimed

  @integration @track3 @unimplemented
  # Carried forward from payload-envelope.feature's GQ1 fail-safe "A missing
  # blob does not wedge the group"; the guarantee survives the rewrite intact.
  Scenario: A missing blob completes the slot without wedging the group
    Given a flat job whose referenced blob has expired or been deleted
    When dispatch delivers it to the worker
    Then the job is completed without invoking the handler
    And the group continues processing subsequent jobs
    And the work remains recoverable via event replay

  # ===========================================================================
  # Track 4 — rollout and backward compatibility
  # ===========================================================================

  @integration @track4 @unimplemented
  Scenario: Envelope v2 writes stay off until the whole fleet reads v2
    Given envelope v2 writes have not been enabled for the deployment
    When a job is staged
    Then the stored value uses the previous on-the-wire format readable by the prior release
    And dispatch and the ops dashboard read it through the dual readers

  @integration @track4 @unimplemented
  Scenario: Legacy GQ1 and bare-JSON jobs staged before the deploy still process
    Given a job staged as a GQ1 envelope or plain JSON by a previous deployment
    When dispatch evaluates and delivers that job
    Then the handler receives the original payload
    And no content-addressed blob is required to resolve it

  @integration @track4 @unimplemented
  Scenario: A pod on the previous release drops a v2 value it cannot parse
    Given a job staged as a v2 envelope
    When a pod from the previous release dispatches it
    Then it completes the group slot without invoking the handler
    And the work remains recoverable via event replay

  # ===========================================================================
  # --- AC Coverage Map (ADR-029) ---
  # Track 1 — content-addressed tiers
  #   AC1.1 "Size picks the tier; inline stays inline"
  #     -> A sub-threshold payload stays inline in the envelope body
  #   AC1.2 "Mid-size offloads to a content-addressed Redis blob"
  #     -> A mid-size payload offloads to a content-addressed Redis blob
  #   AC1.3 "Very large offloads to the S3 tier (reused stored-objects store)"
  #     -> A very large payload offloads to S3 through the reused object store
  #   AC1.4 "Identical bytes collapse to one key; PUT is idempotent"
  #     -> The same bytes always produce the same blob key
  # Track 2 — flat jobs and content-addressed sharing
  #   AC2.1 "One event fanned out N ways is stored once" (the headline win)
  #     -> One event fanned out to many jobs stores the shared payload once
  #   AC2.2 "Event and fold state are hoisted and referenced separately"
  #     -> A reactor job references the shared event and its fold state separately
  #   AC2.3 "Flat job round-trips its payload unchanged"
  #     -> A flat job round-trips its payload through ref resolution unchanged
  #   AC2.4 "Blob keys namespaced by tenant; tenants never share a blob; purge by prefix"
  #     -> Blob keys are namespaced by tenant so tenants never share a blob
  #   AC2.5 "Producer-hoist: cross-shape dedup + serialize-once per fan-out"
  #     -> A projection and a reactor for the same event share one stored event
  # Track 3 — holder-set reclaim and TTL backstop
  #   AC3.1 "Blob lives until the last referencing job completes"
  #     -> A shared blob survives until its last referencing job completes
  #   AC3.2 "Dedup squash releases one hold, not the shared blob" (supersedes GQ1)
  #     -> A dedup squash releases its hold without dropping a still-referenced blob
  #   AC3.3 "Retry keeps the same blob alive"
  #     -> A retry re-stage keeps the same content-addressed blob alive
  #   AC3.4 "S3-tier reclaim via sweeper + lifecycle backstop"
  #     -> An S3-tier blob is reclaimed through the sweeper when its holders empty
  #   AC3.5 "Access refreshes TTL for long-dwell jobs"
  #     -> An access refreshes a blob's TTL so a long-dwell job keeps its payload
  #   AC3.6 "Orphaned blob expires via the backstop"
  #     -> An orphaned blob with no holders expires via its TTL backstop
  #   AC3.7 "Missing blob is a fail-safe, not a wedge" (carried from ADR-026)
  #     -> A missing blob completes the slot without wedging the group
  #   AC3.8 "Blob survives dispatch; released only at terminal retirement"
  #     -> A blob survives dispatch and is released only at terminal retirement
  #   AC3.9 "Atomic release vs concurrent re-stage (TOCTOU)"
  #     -> A completion racing a re-stage of the same content does not delete the live blob
  # Track 4 — rollout and backward compatibility
  #   AC4.1 "v2 writes gated until the fleet reads v2"
  #     -> Envelope v2 writes stay off until the whole fleet reads v2
  #   AC4.2 "Legacy GQ1 / bare-JSON jobs still process"
  #     -> Legacy GQ1 and bare-JSON jobs staged before the deploy still process
  #   AC4.3 "Old pod drops an unparseable v2 value safely"
  #     -> A pod on the previous release drops a v2 value it cannot parse
  #
  # Count: 21 behavioral ACs -> 21 scenarios. All @unimplemented pending the
  # Outside-In TDD pass (integration tests first, then unit, then code).
  # ===========================================================================
