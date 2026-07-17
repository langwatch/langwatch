# See dev/docs/adr/030-groupqueue-blob-handling-hardening.md for the architectural rationale.
Feature: GroupQueue blob-handling hardening
  As the LangWatch event-sourcing queue offloading payloads to content-addressed blobs
  I want bounded memory, transient-vs-missing failure handling, coordinated TTLs,
  atomic hold transfers, tamper-resistant reads, and a cluster-slot guard
  So that a pathological payload, a brief store outage, a long-lived fan-out, a
  partial failure, a tampered envelope, or a mis-tagged queue can never OOM the
  worker, drop work to replay, prematurely reclaim a live blob, cross a tenant
  boundary, or leak silently.

  # Hardens the GQ2 lifecycle from ADR-029
  # (specs/event-sourcing/payload-store-content-addressed.feature). The core
  # contract there stands; these are the edge cases a tests/security/code review
  # surfaced. Where a scenario here REFINES a core-feature AC, the core states
  # the behaviour and this states the hardened mechanism — they don't duplicate:
  #   - Tracks 3+4 (holder TTL coordination, atomic hold transfer) were
  #     superseded by ADR-046: the holder-set refcount was removed and blob
  #     lifetime is a lease (see payload-store-blob-lease.feature). The
  #     scenarios kept in those tracks state the guarantees that survive.
  #
  # Decision (ADR-030):
  #   - Buffered offload throughout; MAX_BLOB_BYTES (50 MiB) rejects the truly
  #     pathological at encode. Content hash is over the raw source JSON, not the
  #     gzip output (no gzip-determinism assumption). Streaming was dropped — the
  #     cap is the memory bound; see ADR-030 §1.
  #   - s3 get: not-found -> fail-safe; transient error -> retryable.
  #   - One BLOB_BACKSTOP_TTL; holder TTL ≥ blob TTL; both refreshed on access.
  #   - Atomic transfer eval (SADD new + SREM old + reclaim-if-empty) on
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
  Scenario: A sub-inline payload stays inline and writes no blob
    When a job whose payload is under the inline ceiling is staged
    Then no blob is written for it

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
  # Tracks 3 + 4 — superseded by ADR-046 (blob leases)
  # ===========================================================================
  # The coordinated holder/blob TTL pair and the atomic hold-transfer eval were
  # removed with the holder-set refcount itself. Blob lifetime is now a lease:
  # set at PUT, renewed on read, extended by block/DLQ. The scenarios that used
  # to live here (holder TTL ordering, atomic transfer, phantom-hold squashes —
  # the 2026-07-09 incident class) are impossible by construction under leases;
  # the lease contract is specified in payload-store-blob-lease.feature.

  @integration @track3
  Scenario: A long-lived fan-out never loses its blob to another job's completion
    Given a fan-out whose jobs remain staged close to the lease window
    When some jobs are dispatched and complete while others are still staged
    Then no completion deletes the shared blob
    And each dispatch read renews the blob's lease for the still-staged jobs

  @integration @track4
  Scenario: A dedup squash needs no hold bookkeeping
    Given a staged offloaded job with a dedup id
    When a second send with the same dedup id squashes it in place
    Then the displaced value's blob is left to its lease
    And the replacement's blob (same content, same key) carries a fresh lease from its PUT

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
    Given a blob holder operation that fails
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
    Because the two-key release and transfer evals require the holder and blob keys in one cluster slot

  # ===========================================================================
  # --- AC Coverage Map (ADR-030) ---
  # Track 1 — bounded-memory offload
  #   AC1.1 buffered mid-MB           -> A mid-MB payload offloads through the buffered path
  #   AC1.2 hash over raw source      -> The content hash is computed over the raw source ...
  #   AC1.3 absolute-ceiling reject   -> A payload above the absolute ceiling is rejected at encode ...
  #   AC1.4 sub-inline no hold        -> A sub-inline payload stays inline and acquires no hold
  # Track 2 — missing vs transient
  #   AC2.1 missing -> fail-safe      -> A genuinely missing s3 blob completes the slot via the fail-safe
  #   AC2.2 transient -> retry        -> A transient s3 error retries instead of dropping to replay
  # Track 3 — coordinated TTLs
  #   AC3.x (holder TTL pair)         -> superseded by ADR-046 leases; see payload-store-blob-lease.feature
  #   AC3.3 no premature reclaim      -> A long-lived fan-out never loses its blob to another job's completion
  # Track 4 — atomic transfer
  #   AC4.1 atomic retry transfer     -> A retry transfers the hold ... in a single atomic step
  #   AC4.2 no reclaim on partial     -> A partial failure during the transfer cannot reclaim a referenced blob
  #   AC4.3 squash transfer           -> A dedup squash leaves no phantom hold and reclaims only unreferenced blobs
  #   AC4.4 squash chain              -> A squash chain never leaves a phantom hold
  #   AC4.5 discard on replace-off    -> A squash that keeps the stored payload acquires no hold for the discarded value
  #   AC4.6 discard post-dispatch     -> A post-dispatch survive-dispatch squash acquires no hold for the discarded value
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
