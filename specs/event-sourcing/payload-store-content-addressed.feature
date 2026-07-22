# See dev/docs/adr/029-groupqueue-content-addressed-payload-store.md for the architectural rationale.
Feature: GroupQueue content-addressed tiered payload store
  As the LangWatch event-sourcing queue absorbing fan-out from a single event
  I want one event's shared payload stored once by content hash and referenced
  by every job it fans out to, across three size tiers, protected by renewable
  time-bounded leases
  So that a dozen-way fan-out costs one payload copy instead of a dozen, the
  queue survives crashes without leaking payloads indefinitely,
  and offload is decided by size alone, not by command-vs-job provenance.

  # Builds on ADR-026's GQ1 envelope (specs/event-sourcing/payload-envelope.feature).
  # Supersedes ADR-026's blob-lifecycle scenarios: random blob ids become content
  # hashes; best-effort-delete + 7-day pure-backstop TTL becomes renewable
  # per-holder leases + a 4-day refreshed backstop. The GQ1 envelope/header/routing/two-phase
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
  #     COMPOSES with it: a squashed slot releases its lease on its blob.
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
  #   - Lease set {queue}:gq:blobleases:<hash> records a deadline per staged job;
  #     lease-take and renewal set `now + lease TTL`, and terminal retirement
  #     removes that holder's lease idempotently. Releases never delete blobs.
  #   - 4-day TTL on Redis blobs and lease deadlines are refreshed on access;
  #     Redis expiry and the durable-store lifecycle sweep reclaim blobs lazily.
  #     A missing blob completes the slot without the handler
  #     (recoverable via replay) — a fail-safe, never a wedge.
  #   - Retiring the LAST lease shortens the blob's expiry to a 1-hour grace
  #     window rather than leaving the full 4-day backstop (2026-07-22, Track 5).
  #     Shortening an expiry is not deletion: any later take re-arms the 4-day
  #     backstop, so the release stays safe against a producer that wrote these
  #     bytes before the release and stages after it.
  #
  # RESOLVED (ADR-029): the s3/file tier reuses the stored-objects StorageDriver/
  # StorageRegistry/URI minting (specs/features/scenarios/externalize-event-byte-content.feature)
  # — the driver only, NOT StoredObjectsService (whose no-GC lifecycle would
  # clash with lease/backstop reclaim). The redis tier stays the queue's own store.
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
    And the released-blob grace window is configured at 1 hour

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
  # Track 3 — lease lifecycle and TTL backstop
  # ===========================================================================

  @integration @track3 @unimplemented
  Scenario: A shared blob survives while any referencing job renews its lease
    Given a blob referenced by three staged jobs
    When two jobs stop renewing and their leases expire
    Then the blob is still present
    When the third job renews its lease
    Then the blob remains readable
    And duplicate lease renewals do not create extra leases

  @integration @track3 @unimplemented
  # Composes leases with the dedup-id squash owned by
  # record-span-gq-dedup.feature. SUPERSEDES payload-envelope.feature's GQ1
  # scenario "Offloaded blobs displaced by a dedup squash are reclaimed":
  # under GQ1 every job owned a private random-id blob, so the squash deleted
  # the displaced blob unconditionally. Under v2 the blob may be shared, so the
  # squashed slot only releases its lease and never deletes the blob eagerly.
  Scenario: A dedup squash releases its lease without dropping a still-referenced blob
    Given two staged jobs referencing the same content-addressed blob
    When a later job with the same dedup id squashes one of them in place
    Then the squashed slot releases its lease on the blob
    And the blob remains because the surviving slot renews its lease

  @integration @track3 @unimplemented
  Scenario: A retry re-stage keeps the same content-addressed blob alive
    Given an offloaded job that fails with a retryable error
    When it is re-staged with its attempt counter incremented
    Then the re-staged slot leases the same content-addressed blob
    And the retry re-encodes to the same hash, so the lease is renewed without a liveness gap
    And the blob is not reclaimed across the retry

  @integration @track3 @unimplemented
  # Dispatch HDELs the job value out of the group hash and hands it to the worker
  # in memory, so the blob must outlive dispatch; dispatch renews the lease and
  # terminal retirement only removes that holder's lease.
  Scenario: A blob survives dispatch through lease renewal
    Given an offloaded job referencing a blob
    When the job is dispatched to the worker
    Then the blob is still present while the handler runs
    And the lease is removed only when the job terminally retires

  @integration @track3 @unimplemented
  # Release never deletes a blob, so a concurrent re-stage cannot race an eager
  # last-holder reclaim.
  Scenario: A completion racing a re-stage of the same content does not delete the live blob
    Given a blob whose last lease holder is completing
    And a new job referencing the same content is staged concurrently
    When the release runs
    Then the blob is retained because releases do not reclaim eagerly
    And no job is left referencing a deleted blob

  @integration @track3 @unimplemented
  Scenario: An S3-tier blob is reclaimed lazily after its leases expire
    Given an S3-tier blob whose holders no longer renew their leases
    When every lease has expired
    Then no completion path deletes the object eagerly
    And the object-store lifecycle sweep eventually reclaims it

  @integration @track3 @unimplemented
  Scenario: An access refreshes the blob and lease so a long-dwell job keeps its payload
    Given an offloaded job held in a retry-backoff chain
    When the job is dispatched after a delay shorter than the TTL
    Then the dispatch refreshes the blob's TTL and the holder's lease deadline
    And the blob is still present for the handler

  @integration @track3 @unimplemented
  # Crash between the client PUT and the Lua stage leaves a blob with an empty
  # lease set; nothing eager reclaims it, so the backstop must.
  Scenario: An orphaned blob with no leases expires via its TTL backstop
    Given a blob written to Redis whose staging never completed
    And no job leases it
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
  # Track 5 — bounded dead-blob retention (2026-07-22 amendment)
  # ===========================================================================
  # Track 3 removed eager reclaim to stop a completion racing a live sibling into
  # deleting a shared blob. It left nothing shorter than the 4-day backstop in its
  # place, so a blob nothing referenced any more still occupied Redis for four
  # days. Nothing drains a retired blob before it ages out, so retention runs the
  # full four days deep — a leak whatever its label. These scenarios
  # bound that retention without restoring the race: the release does not delete
  # the bytes, it only shortens their deadline, and any subsequent take restores
  # the full backstop.
  #
  # Bound by blobLeases.integration.test.ts ("release grace window") and
  # scripts.integration.test.ts ("dedup squash grace window").

  @integration @track5
  Scenario: Retiring the last lease puts a Redis-tier blob on the grace window
    Given a Redis-tier blob whose only lease holder is retiring
    When that holder releases its lease
    Then the blob is still readable
    And its expiry is shortened to the release grace window

  @integration @track5
  Scenario: A blob a sibling still leases keeps its full backstop
    Given a Redis-tier blob leased by two staged jobs
    When one of them releases its lease
    Then the blob keeps its four-day backstop
    And the grace window is withheld while any lease is live

  @integration @track5
  # This is what makes shortening the expiry safe where deleting the bytes was
  # not. A producer PUTs content-addressed bytes and stages a round trip later;
  # if the last lease is retired in that window, the stage re-arms the backstop
  # rather than finding a hole.
  Scenario: A job staged after the grace window began restores the full backstop
    Given a Redis-tier blob placed on the release grace window
    When a new job referencing the same content is staged
    Then the blob's four-day backstop is restored
    And the new job's lease is live

  @integration @track5
  # Belt and braces for a mixed-version fleet: a holder from a release that
  # predates leases writes a token into the legacy holder set and no lease
  # deadline, so an empty lease set alone must not be read as "unreferenced".
  Scenario: A holder from a pre-lease release withholds the grace window
    Given a Redis-tier blob whose only lease holder is retiring
    And a holder token written by a release that predates leases
    When that holder releases its lease
    Then the blob keeps its four-day backstop

  @integration @track5
  Scenario: A dedup squash that retires the last lease puts the displaced blob on the grace window
    Given a staged job holding the only lease on a Redis-tier blob
    When a later job with the same dedup id replaces it with different content
    Then the displaced blob is still readable
    And its expiry is shortened to the release grace window
    And the replacement's own blob carries the full four-day backstop

  @integration @track5
  Scenario: An S3-tier release leaves the object to the durable-store sweep
    Given an S3-tier blob whose only lease holder is retiring
    When that holder releases its lease
    Then no object-store delete is issued
    And the object remains for the durable-store lifecycle sweep

  # ===========================================================================
  # Track 6 — active blob reclaim (2026-07-22)
  # ===========================================================================
  # Track 5 shortened the deadline on a blob whose LAST lease retired, but it can
  # only act at the moment of a release. Two things escape it. A holder killed
  # mid-flight never releases at all, so its blob keeps the full backstop and is
  # re-armed again on every redelivery. And that holder's mirrored token stays in
  # the holder set forever, so the next clean release reads the set as "someone I
  # cannot measure still holds this" and withholds the window from the blob and
  # every sibling sharing its content. Under fleet-wide worker restarts both
  # happen constantly, which is how retention kept growing with the grace window
  # deployed and firing.
  #
  # The reclaim runner closes that gap from outside the release path. It walks the
  # blob keyspace on a schedule and judges each blob on its own lease state rather
  # than on whether a release happened to run. Two passes, deliberately asymmetric
  # in what they are allowed to do:
  #
  #   - Repair only ever SHORTENS a deadline, so it is safe on the same argument
  #     Track 5 rests on: the bytes stay readable and any take re-arms them.
  #     That is what lets it bypass the holder-set guard a release must respect.
  #   - Reclaim is the only pass that destroys bytes, so it demands proof the
  #     grace window has already been running for a margin — which a blob written
  #     but not yet staged can never show.
  #
  # Bound by blobSweeper.integration.test.ts.

  @integration @track6
  Scenario: An unreferenced blob is put on the grace window even though a stale holder token withheld it
    Given a Redis-tier blob with no live lease
    And a holder token left behind by a worker that died before releasing
    When the reclaim runner runs
    Then the blob is still readable
    And its expiry is shortened to the release grace window

  @integration @track6
  Scenario: A blob a live lease still references is left alone
    Given a Redis-tier blob a staged job still leases
    When the reclaim runner runs
    Then the blob keeps its four-day backstop
    And the runner reports it as still referenced

  @integration @track6
  # The put-before-stage window is why reclaim demands a margin. A producer writes
  # content-addressed bytes and stages them a round trip later; for that moment the
  # blob has no lease and no holder, and it must not be mistaken for abandoned.
  Scenario: A blob still within its put-before-stage window is not reclaimed
    Given a Redis-tier blob just written by a producer that has not staged yet
    When the reclaim runner runs
    Then the blob is still readable
    And no delete is issued for it

  @integration @track6
  Scenario: A blob whose grace window has been running past the safety margin is destroyed
    Given a Redis-tier blob with no live lease
    And its grace window has been running longer than the reclaim safety margin
    When the reclaim runner runs
    Then the blob is deleted
    And its lease and holder bookkeeping are deleted with it

  @integration @track6
  Scenario: A dry run reports what it would reclaim without deleting anything
    Given a Redis-tier blob eligible for reclaim
    When the reclaim runner sweeps in dry-run mode
    Then the blob is still readable
    And the runner reports it as eligible for reclaim

  @scheduled @track6
  Scenario: The runner is driven by the schedule, not by a request
    Given the reclaim runner is on its cleanup schedule
    When a cleanup interval comes due
    Then the sweep runs once for that interval
    And it does not run again for the same interval

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
  # Track 3 — lease lifecycle and TTL backstop
  #   AC3.1 "Blob lives while any referencing job renews its lease"
  #     -> A shared blob survives while any referencing job renews its lease
  #   AC3.2 "Dedup squash releases one lease, never the shared blob" (supersedes GQ1)
  #     -> A dedup squash releases its lease without dropping a still-referenced blob
  #   AC3.3 "Retry keeps the same blob alive"
  #     -> A retry re-stage keeps the same content-addressed blob alive
  #   AC3.4 "S3-tier lazy reclaim via lifecycle sweep"
  #     -> An S3-tier blob is reclaimed lazily after its leases expire
  #   AC3.5 "Access refreshes blob TTL and lease for long-dwell jobs"
  #     -> An access refreshes the blob and lease so a long-dwell job keeps its payload
  #   AC3.6 "Orphaned blob expires via the backstop"
  #     -> An orphaned blob with no leases expires via its TTL backstop
  #   AC3.7 "Missing blob is a fail-safe, not a wedge" (carried from ADR-026)
  #     -> A missing blob completes the slot without wedging the group
  #   AC3.8 "Blob survives dispatch through lease renewal"
  #     -> A blob survives dispatch through lease renewal
  #   AC3.9 "Release cannot race a concurrent re-stage into eager deletion"
  #     -> A completion racing a re-stage of the same content does not delete the live blob
  # Track 4 — rollout and backward compatibility
  #   AC4.1 "v2 writes gated until the fleet reads v2"
  #     -> Envelope v2 writes stay off until the whole fleet reads v2
  #   AC4.2 "Legacy GQ1 / bare-JSON jobs still process"
  #     -> Legacy GQ1 and bare-JSON jobs staged before the deploy still process
  #   AC4.3 "Old pod drops an unparseable v2 value safely"
  #     -> A pod on the previous release drops a v2 value it cannot parse
  # Track 5 — bounded dead-blob retention (2026-07-22 amendment)
  #   AC5.1 "Last release shortens the blob's expiry to the grace window"
  #     -> Retiring the last lease puts a Redis-tier blob on the grace window
  #   AC5.2 "A live sibling lease withholds the grace window"
  #     -> A blob a sibling still leases keeps its full backstop
  #   AC5.3 "A later take re-arms the backstop" (why shortening is not deleting)
  #     -> A job staged after the grace window began restores the full backstop
  #   AC5.4 "A pre-lease holder token withholds the grace window"
  #     -> A holder from a pre-lease release withholds the grace window
  #   AC5.5 "The Lua squash release grants the same grace window"
  #     -> A dedup squash that retires the last lease puts the displaced blob on the grace window
  #   AC5.6 "The S3 tier is untouched; the durable sweep still owns it"
  #     -> An S3-tier release leaves the object to the durable-store sweep
  # Track 6 — active blob reclaim (2026-07-22)
  #   AC6.1 "Repair grants the window a stale holder token withheld"
  #     -> An unreferenced blob is put on the grace window even though a stale holder token withheld it
  #   AC6.2 "A live lease is never touched"
  #     -> A blob a live lease still references is left alone
  #   AC6.3 "The put-before-stage window is never destroyed"
  #     -> A blob written but not yet staged is never destroyed
  #   AC6.4 "Reclaim destroys only past the safety margin"
  #     -> A blob whose grace window has been running past the safety margin is destroyed
  #   AC6.5 "Dry run reports without destroying"
  #     -> A dry run reports what it would reclaim without deleting anything
  #   AC6.6 "The sweep is scheduled and singly-executed"
  #     -> The runner is driven by the schedule, not by a request
  #
  # Count: 21 ADR-029 ACs -> 21 scenarios (@unimplemented pending the Outside-In
  # TDD pass), plus 6 Track 5 amendment ACs and 6 Track 6 reclaim ACs -> 12
  # scenarios, all bound.
  # ===========================================================================
