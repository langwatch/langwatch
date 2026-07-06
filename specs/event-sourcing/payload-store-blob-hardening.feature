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
  #   - the squash transfer (Track 4) refines core AC3.2 (dedup-squash reclaim),
  #     making it crash-atomic;
  #   - the TTL-coordination / access-refresh scenarios (Track 3) refine core
  #     AC3.5/AC3.8 (TTL backstop + survive-dispatch), making the holder TTL
  #     outlive the blob and refresh on access.
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
    And the blob backstop TTL is configured at 3 days

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
  Scenario: A sub-inline payload stays inline and acquires no hold
    When a job whose payload is under the inline ceiling is staged
    Then no blob and no holder set are written for it

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
  # Track 3 — coordinated TTLs and premature reclaim
  # ===========================================================================

  @integration @track3 @unimplemented
  Scenario: The holder-set TTL is never shorter than the blob TTL
    When a blob and its holder set are created
    Then the holder set's TTL is greater than or equal to the blob's TTL

  @integration @track3 @unimplemented
  Scenario: Dispatch refreshes the holder set as well as the blob
    Given a blob referenced by several still-staged jobs
    When one referenced job is dispatched near the backstop window
    Then both the blob and its holder set have their TTL refreshed
    And a later completion does not reclaim a blob the other jobs still reference

  @integration @track3 @unimplemented
  Scenario: A long-lived fan-out does not prematurely reclaim a referenced blob
    Given a fan-out whose jobs remain staged close to the backstop window
    When some jobs are dispatched and complete while others are still staged
    Then the blob survives until the last referencing job retires
    And no still-staged job is left pointing at a reclaimed blob

  # ===========================================================================
  # Track 4 — atomic hold transfer (no reclaim gap)
  # ===========================================================================

  @integration @track4 @unimplemented
  Scenario: A retry transfers the hold to the new token in a single atomic step
    Given an offloaded job that fails with a retryable error
    When it is re-staged on the same content hash
    Then the new token is added and the old token removed atomically
    And the blob is never observable at zero holders during the transfer

  @integration @track4 @unimplemented
  Scenario: A partial failure during the transfer cannot reclaim a referenced blob
    Given a hold transfer where the release half would otherwise run before the acquire
    When the transfer eval runs
    Then the old blob is reclaimed only if its holder set is empty after the transfer
    And a still-needed blob is never reclaimed

  @integration @track4 @unimplemented
  Scenario: A dedup squash transfers the hold without dropping a shared blob
    Given two staged jobs on the same content hash
    When a squash displaces one of them
    Then the displaced token is transferred in the same atomic step
    And the blob remains while the surviving job holds it

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
  #   AC3.1 holder TTL ≥ blob TTL     -> The holder-set TTL is never shorter than the blob TTL
  #   AC3.2 dispatch refreshes both   -> Dispatch refreshes the holder set as well as the blob
  #   AC3.3 no premature reclaim      -> A long-lived fan-out does not prematurely reclaim a referenced blob
  # Track 4 — atomic transfer
  #   AC4.1 atomic retry transfer     -> A retry transfers the hold ... in a single atomic step
  #   AC4.2 no reclaim on partial     -> A partial failure during the transfer cannot reclaim a referenced blob
  #   AC4.3 squash transfer           -> A dedup squash transfers the hold without dropping a shared blob
  # Track 5 — tamper / tenancy
  #   AC5.1 re-mint on read           -> The read location is re-minted from (projectId, hash) ...
  #   AC5.2 tamper cannot cross tenant-> A tampered ref cannot read another tenant's blob
  #   AC5.3 tenant-attributed logs    -> Blob log lines are tenant-attributed and never leak the bucket
  # Track 6 — cluster-slot guard
  #   AC6.1 reject hash-tag-less name -> A queue name without a Redis hash tag is rejected at construction
  #
  # Count: 16 behavioral ACs -> 16 scenarios. Streaming (the original AC1.2) was
  # dropped in implementation — the cap is the memory bound (ADR-030 §1).
  # ===========================================================================
