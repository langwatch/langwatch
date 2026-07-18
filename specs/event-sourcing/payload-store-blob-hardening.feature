# See dev/docs/adr/030-groupqueue-blob-handling-hardening.md for the architectural rationale.
Feature: GroupQueue blob-handling hardening
  As the LangWatch event-sourcing queue offloading payloads to content-addressed blobs
  I want bounded memory, transient-vs-missing failure handling, renewable leases,
  idempotent lease transfers, tamper-resistant reads, and a cluster-slot guard
  So that a pathological payload, a brief store outage, a long-lived fan-out, a
  partial failure, a tampered envelope, or a mis-tagged queue can never OOM the
  worker, drop work to replay, prematurely reclaim a live blob, cross a tenant
  boundary, or leak past the lease and sweep windows.

  # Hardens the GQ2 lifecycle from ADR-029
  # (specs/event-sourcing/payload-store-content-addressed.feature). The core
  # contract there stands; these are the edge cases a tests/security/code review
  # surfaced. Where a scenario here REFINES a core-feature AC, the core states
  # the behaviour and this states the hardened mechanism — they don't duplicate:
  #   - the squash transfer (Track 4) refines core AC3.2 (dedup-squash leasing),
  #     making duplicate transitions idempotent;
  #   - the TTL-coordination / access-refresh scenarios (Track 3) refine core
  #     AC3.5/AC3.8 (TTL backstop + survive-dispatch), making the lease deadline
  #     and blob TTL refresh together on access.
  #
  # Decision (ADR-030):
  #   - Buffered offload throughout; MAX_BLOB_BYTES (50 MiB) rejects the truly
  #     pathological at encode. Content hash is over the raw source JSON, not the
  #     gzip output (no gzip-determinism assumption). Streaming was dropped — the
  #     cap is the memory bound; see ADR-030 §1.
  #   - s3 get: not-found -> fail-safe; transient error -> retryable.
  #   - One BLOB_LEASE_TTL; per-holder deadlines and blob TTL refresh on access.
  #   - Atomic transfer eval (take new lease + release old lease, never reclaim) on
  #     retry/squash; re-mint read location from (projectId, hash), don't trust
  #     the stored ref.uri; assert the queue name carries a Redis hash tag.

  Background:
    Given a GroupQueue with GQ2 content-addressed offload enabled
    And the absolute ceiling is configured at 50 MiB
    And the blob backstop TTL is configured at 4 days

  # ===========================================================================
  # Track 1 — bounded-memory offload (cap + hash-over-raw)
  # ===========================================================================

  @integration @track1 @unimplemented
  Scenario: A mid-MB payload offloads through the buffered path
    When a job whose payload is 2 MiB is staged
    Then the body is gzipped and stored under its content-addressed key
    And the worker never holds more than the source string plus one compressed buffer

  @unit @track1 @unimplemented
  Scenario: The content hash is computed over the raw source, not the gzipped bytes
    Given two byte-identical payloads
    When each is offloaded
    Then both resolve to the same content-addressed key
    And the key does not depend on gzip output being byte-deterministic

  @unit @track1 @unimplemented
  Scenario: A payload above the absolute ceiling is rejected at encode, not stored
    Given a payload larger than the absolute ceiling
    When it is staged
    Then encode throws PayloadTooLargeError before gzipping or storing it
    And the producer surfaces the error rather than the worker OOMing

  @unit @track1 @unimplemented
  Scenario: A sub-inline payload stays inline and acquires no lease
    When a job whose payload is under the inline ceiling is staged
    Then no blob and no lease set are written for it

  # ===========================================================================
  # Track 2 — missing vs transient store errors
  # ===========================================================================

  @integration @track2 @unimplemented
  Scenario: A genuinely missing s3 blob completes the slot via the fail-safe
    Given an offloaded job whose s3 object has been deleted
    When dispatch resolves the blob and the store returns not-found
    Then the job is completed without invoking the handler
    And the work remains recoverable via event replay

  @integration @track2 @unimplemented
  Scenario: A transient s3 error retries instead of dropping to replay
    Given an offloaded job whose s3 read fails with a transient error
    When dispatch resolves the blob
    Then the error is surfaced as retryable
    And the job is retried rather than completed without the handler

  # ===========================================================================
  # Track 3 — renewable leases and crash-safe reclaim
  # ===========================================================================

  @integration @track3 @unimplemented
  Scenario: A crashed holder cannot leak a Redis blob indefinitely
    Given a holder takes a lease and dies without releasing it
    When its lease and the Redis backstop TTL elapse without renewal
    Then the lease expires
    And the blob is reclaimed no later than the lease TTL plus the sweep interval

  @integration @track3 @unimplemented
  Scenario: Dispatch refreshes the holder lease as well as the blob
    Given a blob referenced by several still-staged jobs
    When one referenced job is dispatched near the backstop window
    Then both the blob TTL and that holder's lease deadline are refreshed
    And a later completion does not reclaim a blob the other jobs still reference

  @integration @track3 @unimplemented
  Scenario: A live lease prevents reclaim while crashed sibling leases expire
    Given a fan-out where one job renews and its sibling holders crash
    When the crashed holders' leases expire
    Then the blob survives while the live job keeps renewing
    And the active-job heartbeat renews a lease throughout a long-running handler
    And no still-staged job is left pointing at a reclaimed blob

  # ===========================================================================
  # Track 4 — idempotent lease transfer (no reclaim path)
  # ===========================================================================

  @integration @track4 @unimplemented
  Scenario: A retry transfers the lease to the new token in a single atomic step
    Given an offloaded job that fails with a retryable error
    When it is re-staged on the same content hash
    Then the new lease is taken and the old lease removed atomically
    And the blob is never deleted by the transfer

  @integration @track4 @unimplemented
  Scenario: Duplicate lease takes and releases are idempotent
    Given a holder lease is taken more than once
    Then only one lease exists for that holder
    When that holder lease is released more than once
    Then the duplicate release is a no-op and never reclaims the blob

  # The 2026-07-09 incident: send() fired the squash's lifecycle transfer after the
  # stage eval returned, fire-and-forget. Concurrent squashes of the same dedup
  # id could reorder at Redis — a later transfer re-added a token an earlier
  # transfer had already displaced — leaving a phantom entry that pinned the
  # blob until its TTL. At prod fan-out rates that left ~279k orphaned blobs
  # (~1.9 GB, ~90% of Redis growth). The transfer now happens INSIDE the stage
  # eval, atomic with the displacement it accounts for.
  @integration @track4
  Scenario: A dedup squash leaves no phantom lease and never eagerly reclaims blobs
    Given a staged offloaded job with a dedup id
    When a second send with the same dedup id squashes it in place
    Then the replacement's lease is taken and the displaced lease is removed
    And a displaced blob is left to lazy backstop reclaim

  @integration @track4
  Scenario: A squash chain never leaves a phantom lease
    Given a job squashed twice in succession under one dedup id
    When both squashes have completed
    Then only the final value's lease remains in its lease set
    And every displaced blob is left to lazy backstop reclaim

  # A squash configured not to replace the payload discards the NEW value, not
  # the stored one. The discarded value was never staged, so nothing may
  # take a lease for it — the old code self-transferred (new == old) and
  # minted exactly such a phantom entry. Its blob, when content-unique, is left
  # to the TTL backstop; when shared, the surviving job's lease keeps it alive.
  @integration @track4
  Scenario: A squash that keeps the stored payload takes no lease for the discarded value
    Given a staged offloaded job whose dedup is configured to keep the stored payload
    When a second send with the same dedup id is squashed
    Then the stored job's lease is untouched
    And no lease is recorded for the discarded value

  @integration @track4
  Scenario: A post-dispatch survive-dispatch squash takes no lease for the discarded value
    Given a dedup id whose job was already dispatched but whose survive-dispatch TTL is alive
    When a late re-trigger is squashed against it
    Then no lease is recorded for the discarded value
    And the discarded value's blob is left to the TTL backstop

  # ===========================================================================
  # Track 5 — tamper resistance and tenant isolation
  # ===========================================================================

  @unit @track5 @unimplemented
  Scenario: The read location is re-minted from (projectId, hash), not the stored ref
    Given an envelope whose stored ref.uri points at a different bucket than the project resolves to
    When the blob is read
    Then the read location is derived from the project's resolved destination and the content hash
    And the stored ref.uri is not used to locate the object

  @unit @track5 @unimplemented
  Scenario: A tampered ref cannot read another tenant's blob
    Given a tampered envelope carrying another tenant's projectId or uri
    When the blob is read
    Then the read is scoped to the owning project's namespace and destination
    And no cross-tenant object is returned

  @unit @track5 @unimplemented
  Scenario: Blob log lines are tenant-attributed and never leak the bucket
    Given a blob lease operation that fails
    When the failure is logged
    Then the log line carries the owning projectId and the content hash
    And it never logs a bare hash without its tenant
    And it never logs the raw object-store uri or bucket name

  # ===========================================================================
  # Track 6 — cluster-slot guard
  # ===========================================================================

  @unit @track6 @unimplemented
  Scenario: A queue name without a Redis hash tag is rejected at construction
    Given a GroupQueue constructed with a name lacking a hash tag
    When the queue is constructed
    Then construction fails fast with a clear error
    Because lease transfer and rolling-deploy compatibility keys must share one cluster slot

  # ===========================================================================
  # --- AC Coverage Map (ADR-030) ---
  # Track 1 — bounded-memory offload
  #   AC1.1 buffered mid-MB           -> A mid-MB payload offloads through the buffered path
  #   AC1.2 hash over raw source      -> The content hash is computed over the raw source ...
  #   AC1.3 absolute-ceiling reject   -> A payload above the absolute ceiling is rejected at encode ...
  #   AC1.4 sub-inline no lease       -> A sub-inline payload stays inline and acquires no lease
  # Track 2 — missing vs transient
  #   AC2.1 missing -> fail-safe      -> A genuinely missing s3 blob completes the slot via the fail-safe
  #   AC2.2 transient -> retry        -> A transient s3 error retries instead of dropping to replay
  # Track 3 — renewable leases
  #   AC3.1 crash expires             -> A crashed holder cannot leak a Redis blob indefinitely
  #   AC3.2 dispatch refreshes both   -> Dispatch refreshes the holder lease as well as the blob
  #   AC3.3 no premature reclaim      -> A live lease prevents reclaim while crashed sibling leases expire
  # Track 4 — idempotent transfer
  #   AC4.1 atomic retry transfer     -> A retry transfers the lease ... in a single atomic step
  #   AC4.2 duplicate idempotency     -> Duplicate lease takes and releases are idempotent
  #   AC4.3 squash transfer           -> A dedup squash leaves no phantom lease and never eagerly reclaims blobs
  #   AC4.4 squash chain              -> A squash chain never leaves a phantom lease
  #   AC4.5 discard on replace-off    -> A squash that keeps the stored payload takes no lease for the discarded value
  #   AC4.6 discard post-dispatch     -> A post-dispatch survive-dispatch squash takes no lease for the discarded value
  # Track 5 — tamper / tenancy
  #   AC5.1 re-mint on read           -> The read location is re-minted from (projectId, hash) ...
  #   AC5.2 tamper cannot cross tenant-> A tampered ref cannot read another tenant's blob
  #   AC5.3 tenant-attributed logs    -> Blob log lines are tenant-attributed and never leak the bucket
  # Track 6 — cluster-slot guard
  #   AC6.1 reject hash-tag-less name -> A queue name without a Redis hash tag is rejected at construction
  #
  # Count: 19 behavioral ACs -> 19 scenarios. Streaming (the original AC1.2) was
  # dropped in implementation — the cap is the memory bound (ADR-030 §1).
  # ===========================================================================
