# See ../adrs/029-content-addressed-payload-store.md
Feature: GroupQueue content-addressed tiered payload store
  As the LangWatch event-sourcing queue absorbing fan-out from a single event
  I want one event's shared payload stored once by content hash and referenced
  by every job it fans out to, across three size tiers, protected by renewable
  time-bounded leases
  So that a dozen-way fan-out costs one payload copy instead of a dozen, the
  queue survives crashes without leaking payloads indefinitely,
  and offload is decided by size alone, not by command-vs-job provenance.

  # TWO mechanisms share the word "dedup" — this spec keeps them apart:
  #   - content-addressed sharing / "store-once" (THIS feature): one shared
  #     payload component (event, fold state) is stored ONCE by content hash;
  #     every job carrying identical bytes references that single copy.
  #   - dedup-id squash (NOT this feature): STAGE_LUA collapses same-identity
  #     staged jobs into one HSET field — owned by
  #     specs/traces/record-span-gq-dedup.feature, configured per
  #     ../../eventing/specs/deduplication-strategy.feature. This feature only
  #     COMPOSES with it: a squashed slot releases its lease on its blob.
  #
  # Decision (ADR-029):
  #   - Three tiers by serialized size: inline ≤4 KiB · redis 4 KiB–256 KiB ·
  #     s3 >256 KiB (boundary aligned with ADR-022 COMMAND_INLINE_THRESHOLD).
  #   - Blob id = SHA-256(canonical bytes) truncated to 128 bits, base64url.
  #     Identical bytes -> identical key -> one stored copy. PUTs idempotent.
  #     Keys are namespaced by projectId and the caller-owned group-queue segment,
  #     minting s3://{bucket}/{projectId}/group-queue/<hash>. Tenants never share
  #     a blob, feature sweeps cannot reach Stored Objects, and the platform can
  #     still purge the complete project prefix.
  #   - Flat jobs: the fan-out producer hoists the shared component (event, fold
  #     state) out of every job; each job carries refs, not the payload. Decode
  #     resolves refs before the handler, which is unchanged.
  #   - Lease set {queue}:gq:blobleases:<hash> records a deadline per staged job;
  #     lease-take and renewal set `now + lease TTL`, and terminal retirement
  #     removes that holder's lease idempotently. Releases never delete blobs.
  #   - 4-day TTL on Redis blobs and lease deadlines are refreshed on access;
  #     Redis expiry and GroupQueue's durable-tier sweep reclaim blobs lazily.
  #     A missing blob completes the slot without the handler
  #     (recoverable via replay) — a fail-safe, never a wedge.
  #   - Retiring the LAST lease shortens the blob's expiry to a 1-hour grace
  #     window rather than leaving the full 4-day backstop.
  #     Shortening an expiry is not deletion: any later take re-arms the 4-day
  #     backstop, so the release stays safe against a producer that wrote these
  #     bytes before the release and stages after it.
  #
  # The s3/file tier uses GroupQueue's injected object-store capability.
  # GroupQueue does NOT import Stored Objects or adopt its lifecycle;
  # its lease/backstop reclaim stays here.
  #
  # Related decisions: ADR-026 owns the envelope and ADR-029 owns content
  # storage. Pause behaviour remains in specs/queue-pausing/queue-pausing.feature.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades
    And the inline tier ceiling is configured at 4 KiB
    And the S3 tier threshold is configured at 256 KiB
    And the blob TTL backstop is configured at 4 days
    And the released-blob grace window is configured at 1 hour

  # ===========================================================================
  # content-addressed tiers
  # ===========================================================================

  @integration @unimplemented
  Scenario: A sub-threshold payload stays inline in the envelope body
    When a job whose shared payload is under the inline ceiling is staged
    Then the stored value is an envelope carrying the payload in its body
    And no standalone blob key is written for it

  @integration @unimplemented
  Scenario: A mid-size payload offloads to a content-addressed Redis blob
    When a job whose shared payload is between the inline ceiling and the S3 threshold is staged
    Then the body is stored under a standalone Redis key named by its content hash
    And the queued value is a flat envelope referencing the blob by tier "redis" and hash
    And the handler receives the payload intact

  @integration @unimplemented
  Scenario: A very large payload offloads to S3 through the reused object store
    When a job whose shared payload exceeds the S3 threshold is staged
    Then the body is stored via the neutral object-storage port under {projectId}/group-queue/{contentHash}
    And the queued value is a flat envelope referencing the blob by tier "s3" and hash
    And the handler receives the payload intact

  @unit @unimplemented
  Scenario: The same bytes always produce the same blob key
    Given two payloads with byte-identical canonical serializations
    When each is offloaded
    Then both resolve to the same content-addressed key
    And the second offload is a no-op PUT over the existing key

  # ===========================================================================
  # flat jobs and content-addressed sharing (store-once)
  # ===========================================================================

  @integration @unimplemented
  # One event may fan out to many jobs, but its shared payload is stored once.
  Scenario: One event fanned out to many jobs stores the shared payload once
    Given an event is dispatched to a fold projection, several map projections, and a chain of subscribers
    When the resulting jobs are staged
    Then the shared event is stored under a single content-addressed key
    And every staged job references that key rather than embedding the event
    And the number of stored copies of the event is one regardless of the fan-out width

  @integration @unimplemented
  Scenario: A subscriber job references the shared event and its fold state separately
    Given a fold whose subscribers each receive the event and the same fold state
    When the subscriber jobs are staged
    Then the event is stored once under its content hash
    And the fold state is stored once under its content hash
    And each subscriber job carries a ref to the event and a ref to the fold state
    And the handler still receives a payload deep-equal to { event, foldState }

  @integration @unimplemented
  # The producer-hoist payoff: a projection job (event sent spread) and a subscriber
  # job (event nested in { event, foldState }) carry DIFFERENT shapes, yet the
  # event is lifted at the fan-out point before the shapes diverge, so both
  # reference one stored copy. A per-job encoder hoist would miss this.
  Scenario: A projection and a subscriber for the same event share one stored event
    Given one event dispatched to both a map projection and a subscriber
    When their jobs are staged
    Then the event is hoisted at the fan-out point and stored once
    And the projection job and the subscriber job both reference that single copy
    And the event was serialized and stored once for the fan-out, not once per job

  @integration @unimplemented
  Scenario: A flat job round-trips its payload through ref resolution unchanged
    When a flat job is staged and later dispatched to its handler
    Then the handler receives a payload deep-equal to the one that was sent
    And a resolve-adapter reconstituted the components before the handler ran
    And the wire value carried refs in place of the shared components

  @unit @unimplemented
  # Multi-tenancy guard: blob keys are namespaced by projectId (the tenant id;
  # tenantId === projectId) and the caller-owned group-queue segment. Isolation
  # is structural — in the key path — not incidental to content. GroupQueue can
  # sweep only .../{projectId}/group-queue/*, while the platform project-delete
  # cascade can purge .../{projectId}/* across registered owner namespaces. The
  # Redis tier needs none; its 4-day TTL clears once the project's jobs drain.
  Scenario: Blob keys are namespaced by tenant so tenants never share a blob
    Given two tenants whose jobs carry byte-identical user content
    When each payload is offloaded
    Then each blob key is namespaced under its own projectId and group-queue owner segment
    And the two payloads resolve to different keys
    And neither tenant's job can resolve the other tenant's blob

  # ===========================================================================
  # Lease lifecycle and TTL backstop
  # ===========================================================================

  @integration @unimplemented
  Scenario: A shared blob survives while any referencing job renews its lease
    Given a blob referenced by three staged jobs
    When two jobs stop renewing and their leases expire
    Then the blob is still present
    When the third job renews its lease
    Then the blob remains readable
    And duplicate lease renewals do not create extra leases

  @integration @unimplemented
  # Composes leases with the dedup-id squash owned by
  # record-span-gq-dedup.feature. A shared blob remains live until its own
  # holder leases have ended.
  Scenario: A dedup squash releases its lease without dropping a still-referenced blob
    Given two staged jobs referencing the same content-addressed blob
    When a later job with the same dedup id squashes one of them in place
    Then the squashed slot releases its lease on the blob
    And the blob remains because the surviving slot renews its lease

  @integration @unimplemented
  Scenario: A retry re-stage keeps the same content-addressed blob alive
    Given an offloaded job that fails with a retryable error
    When it is re-staged with its attempt counter incremented
    Then the re-staged slot leases the same content-addressed blob
    And the retry re-encodes to the same hash, so the lease is renewed without a liveness gap
    And the blob is not reclaimed across the retry

  @integration @unimplemented
  # Dispatch HDELs the job value out of the group hash and hands it to the worker
  # in memory, so the blob must outlive dispatch; dispatch renews the lease and
  # terminal retirement only removes that holder's lease.
  Scenario: A blob survives dispatch through lease renewal
    Given an offloaded job referencing a blob
    When the job is dispatched to the worker
    Then the blob is still present while the handler runs
    And the lease is removed only when the job terminally retires

  @integration @unimplemented
  # Release never deletes a blob, so a concurrent re-stage cannot race an eager
  # last-holder reclaim.
  Scenario: A completion racing a re-stage of the same content does not delete the live blob
    Given a blob whose last lease holder is completing
    And a new job referencing the same content is staged concurrently
    When the release runs
    Then the blob is retained because releases do not reclaim eagerly
    And no job is left referencing a deleted blob

  @integration @unimplemented
  Scenario: An S3-tier blob is reclaimed lazily after its leases expire
    Given an S3-tier blob whose holders no longer renew their leases
    When every lease has expired
    Then no completion path deletes the object eagerly
    And the object-store lifecycle sweep eventually reclaims it

  @integration @unimplemented
  Scenario: An access refreshes the blob and lease so a long-dwell job keeps its payload
    Given an offloaded job held in a retry-backoff chain
    When the job is dispatched after a delay shorter than the TTL
    Then the dispatch refreshes the blob's TTL and the holder's lease deadline
    And the blob is still present for the handler

  @integration @unimplemented
  # Crash between the client PUT and the Lua stage leaves a blob with an empty
  # lease set; nothing eager reclaims it, so the backstop must.
  Scenario: An orphaned blob with no leases expires via its TTL backstop
    Given a blob written to Redis whose staging never completed
    And no job leases it
    When the TTL backstop elapses without any access refreshing it
    Then the blob is reclaimed

  @integration @unimplemented
  Scenario: A missing blob completes the slot without wedging the group
    Given a flat job whose referenced blob has expired or been deleted
    When dispatch delivers it to the worker
    Then the job is completed without invoking the handler
    And the group continues processing subsequent jobs
    And the work remains recoverable via event replay

  # ===========================================================================
  # Bounded inactive-blob retention
  # ===========================================================================
  # Release never deletes shared bytes eagerly. When the final measurable lease
  # ends, it shortens the Redis deadline; any subsequent take restores the full
  # backstop before the new holder can read the body.
  #
  # Bound by blobLeases.integration.test.ts ("release grace window") and
  # scripts.integration.test.ts ("dedup squash grace window").

  @integration
  Scenario: Retiring the last lease puts a Redis-tier blob on the grace window
    Given a Redis-tier blob whose only lease holder is retiring
    When that holder releases its lease
    Then the blob is still readable
    And its expiry is shortened to the release grace window

  @integration
  Scenario: A blob a sibling still leases keeps its full backstop
    Given a Redis-tier blob leased by two staged jobs
    When one of them releases its lease
    Then the blob keeps its four-day backstop
    And the grace window is withheld while any lease is live

  @integration
  # Staging re-arms the backstop before a new holder reads the body, so a
  # concurrent final release can shorten the deadline without creating a hole.
  Scenario: A job staged after the grace window began restores the full backstop
    Given a Redis-tier blob placed on the release grace window
    When a new job referencing the same content is staged
    Then the blob's four-day backstop is restored
    And the new job's lease is live

  @integration
  Scenario: A dedup squash that retires the last lease puts the displaced blob on the grace window
    Given a staged job holding the only lease on a Redis-tier blob
    When a later job with the same dedup id replaces it with different content
    Then the displaced blob is still readable
    And its expiry is shortened to the release grace window
    And the replacement's own blob carries the full four-day backstop

  @integration
  Scenario: An S3-tier release leaves the object to the GroupQueue durable-tier sweep
    Given an S3-tier blob whose only lease holder is retiring
    When that holder releases its lease
    Then no object-store delete is issued
    And the object remains for the GroupQueue durable-tier lifecycle sweep

  # ===========================================================================
  # Active blob reclaim
  # ===========================================================================
  # A worker can disappear without releasing its lease, leaving an expired
  # holder token that prevents the release path from shortening the blob's
  # deadline. The scheduled reclaim runner judges each blob from its current
  # lease state. Its two passes are deliberately asymmetric:
  #
  #   - Repair only shortens a deadline. The bytes stay readable and any take
  #     re-arms them, so repair may ignore expired holder tokens.
  #   - Reclaim is the only pass that destroys bytes, so it demands proof the
  #     grace window has already been running for a margin — which a blob written
  #     but not yet staged can never show.
  #
  # Bound by blobSweeper.integration.test.ts.

  @integration
  Scenario: An unreferenced blob is put on the grace window even though a stale holder token withheld it
    Given a Redis-tier blob with no live lease
    And a holder token left behind by a worker that died before releasing
    When the reclaim runner runs
    Then the blob is still readable
    And its expiry is shortened to the release grace window

  @integration
  Scenario: A blob a live lease still references is left alone
    Given a Redis-tier blob a staged job still leases
    When the reclaim runner runs
    Then the blob keeps its four-day backstop
    And the runner reports it as still referenced

  @integration
  # The put-before-stage window is why reclaim demands a margin. A producer writes
  # content-addressed bytes and stages them a round trip later; for that moment the
  # blob has no lease and no holder, and it must not be mistaken for abandoned.
  Scenario: A blob still within its put-before-stage window is not reclaimed
    Given a Redis-tier blob just written by a producer that has not staged yet
    When the reclaim runner runs
    Then the blob is still readable
    And a producer that stages it later still finds it

  @integration
  Scenario: A blob whose grace window has been running past the safety margin is destroyed
    Given a Redis-tier blob with no live lease
    And its grace window has been running longer than the reclaim safety margin
    When the reclaim runner runs
    Then the blob is deleted
    And it leaves no trace behind

  @integration
  Scenario: A dry run reports what it would reclaim without deleting anything
    Given a Redis-tier blob eligible for reclaim
    When the reclaim runner sweeps in dry-run mode
    Then the blob is still readable
    And the runner reports it as eligible for reclaim

  @integration
  # A sweep judges only so many blobs before it stops, and hands the rest to the
  # next one. That only holds if each sweep takes over where the last left off. A
  # runner that always begins again at the same place re-judges the same blobs
  # forever, and the ones behind them keep their full backstop however often it
  # runs — which looks like a healthy sweep in the totals.
  Scenario: Successive sweeps reach the blobs the previous ones stopped short of
    Given more unreferenced Redis-tier blobs than one sweep judges
    When the reclaim runner sweeps enough times to cover them all
    Then every blob has been put on the grace window
    And none is left on its four-day backstop

  @integration
  Scenario: Once every blob has been judged the runner begins again
    Given the reclaim runner has judged every blob it can see
    When a new unreferenced blob is written and the runner sweeps again
    Then the new blob is put on the grace window

  @integration
  # A dry run is an operator asking what would happen. If it counted the blobs it
  # only looked at as judged, asking the question would silently cost the next
  # real sweep the chance to act on them.
  Scenario: A dry run leaves the blobs it inspected for the next real sweep
    Given more unreferenced Redis-tier blobs than one sweep judges
    When the runner sweeps in dry-run mode
    Then it records no progress for the next sweep to resume from
    And only a real sweep records any

  @integration
  # How much a sweep costs is decided by how far it looks, not by how much it
  # finds. Capping only what it finds leaves it unbounded whenever there is
  # little to find, which is the state the runner is meant to reach.
  Scenario: A sweep stays bounded even when it finds almost nothing to judge
    Given a blob store holding almost nothing the runner can judge
    When the reclaim runner sweeps
    Then the sweep still stops at a limit of its own
    And it reports itself unfinished so the next one carries on

  @scheduled
  Scenario: The runner is driven by the schedule, not by a request
    Given the reclaim runner is on its cleanup schedule
    When a cleanup interval comes due
    Then the sweep runs once for that interval
    And it does not run again for the same interval
