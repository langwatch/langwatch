# See ../adrs/029-content-addressed-payload-store.md
Feature: GroupQueue blob-handling hardening
  As the LangWatch event-sourcing queue offloading payloads to content-addressed blobs
  I want bounded memory, transient-vs-missing failure handling, renewable leases,
  idempotent lease transfers, tamper-resistant reads, and a cluster-slot guard
  So that a pathological payload, a brief store outage, a long-lived fan-out, a
  partial failure, a tampered envelope, or a mis-tagged queue can never OOM the
  worker, drop work to replay, prematurely reclaim a live blob, cross a tenant
  boundary, or leak past the lease and sweep windows.

  # Hardens the content-addressed lifecycle from ADR-029
  # (payload-store-content-addressed.feature). The core
  # contract there stands; these scenarios specify its security and failure
  # boundaries. Squash transfer is idempotent, and lease deadlines refresh with
  # blob TTLs on access.
  #
  # Decision (ADR-029):
  #   - Buffered offload throughout; MAX_BLOB_BYTES (50 MiB) rejects the truly
  #     pathological at encode. Content hash is over the raw source JSON, not the
  #     gzip output (no gzip-determinism assumption). The cap is the memory bound.
  #   - s3 get: not-found -> fail-safe; transient error -> retryable.
  #   - One BLOB_LEASE_TTL; per-holder deadlines and blob TTL refresh on access.
  #   - Atomic transfer eval (take new lease + release old lease, never reclaim) on
  #     retry/squash; re-mint read location from (projectId, hash), don't trust
  #     the stored ref.uri; assert the queue name carries a Redis hash tag.

  Background:
    Given a GroupQueue with content-addressed offload enabled
    And the absolute ceiling is configured at 50 MiB
    And the blob backstop TTL is configured at 4 days

  # ===========================================================================
  # bounded-memory offload (cap + hash-over-raw)
  # ===========================================================================

  @integration @unimplemented
  Scenario: A mid-MB payload offloads through the buffered path
    When a job whose payload is 2 MiB is staged
    Then the body is gzipped and stored under its content-addressed key
    And the worker never holds more than the source string plus one compressed buffer

  @unit @unimplemented
  Scenario: The content hash is computed over the raw source, not the gzipped bytes
    Given two byte-identical payloads
    When each is offloaded
    Then both resolve to the same content-addressed key
    And the key does not depend on gzip output being byte-deterministic

  @unit @unimplemented
  Scenario: A payload above the absolute ceiling is rejected at encode, not stored
    Given a payload larger than the absolute ceiling
    When it is staged
    Then encode throws PayloadTooLargeError before gzipping or storing it
    And the producer surfaces the error rather than the worker OOMing

  @unit @unimplemented
  Scenario: A sub-inline payload stays inline and acquires no lease
    When a job whose payload is under the inline ceiling is staged
    Then no blob and no lease set are written for it

  # ===========================================================================
  # missing vs transient store errors
  # ===========================================================================

  @integration @unimplemented
  Scenario: A genuinely missing s3 blob completes the slot via the fail-safe
    Given an offloaded job whose s3 object has been deleted
    When dispatch resolves the blob and the store returns not-found
    Then the job is completed without invoking the handler
    And the work remains recoverable via event replay

  @integration @unimplemented
  Scenario: A transient s3 error retries instead of dropping to replay
    Given an offloaded job whose s3 read fails with a transient error
    When dispatch resolves the blob
    Then the error is surfaced as retryable
    And the job is retried rather than completed without the handler

  # ===========================================================================
  # renewable leases and crash-safe reclaim
  # ===========================================================================

  @integration @unimplemented
  Scenario: A crashed holder cannot leak a Redis blob indefinitely
    Given a holder takes a lease and dies without releasing it
    When its lease and the Redis backstop TTL elapse without renewal
    Then the lease expires
    And the blob is reclaimed no later than the Redis backstop TTL

  @integration @unimplemented
  Scenario: Dispatch refreshes the holder lease as well as the blob
    Given a blob referenced by several still-staged jobs
    When one referenced job is dispatched near the backstop window
    Then both the blob TTL and that holder's lease deadline are refreshed
    And a later completion does not reclaim a blob the other jobs still reference

  @integration @unimplemented
  Scenario: A live lease prevents reclaim while crashed sibling leases expire
    Given a fan-out where one job renews and its sibling holders crash
    When the crashed holders' leases expire
    Then the blob survives while the live job keeps renewing
    And the active-job heartbeat renews a lease throughout a long-running handler
    And no still-staged job is left pointing at a reclaimed blob

  @integration
  Scenario: A sibling completing never strips a co-staged job's blob
    Given two sibling jobs staged on one content-addressed payload
    When the first sibling completes and releases its lease
    Then the surviving sibling still leases the payload
    And the payload is still readable when that sibling dispatches
    And releasing the last lease leaves the payload to its backstop

  # ===========================================================================
  # idempotent lease transfer (no reclaim path)
  # ===========================================================================

  @integration @unimplemented
  Scenario: A retry transfers the lease to the new token in a single atomic step
    Given an offloaded job that fails with a retryable error
    When it is re-staged on the same content hash
    Then the new lease is taken and the old lease removed atomically
    And the blob is never deleted by the transfer

  @integration @unimplemented
  Scenario: Duplicate lease takes and releases are idempotent
    Given a holder lease is taken more than once
    Then only one lease exists for that holder
    When that holder lease is released more than once
    Then the duplicate release is a no-op and never reclaims the blob

  # Squash lifecycle transfer is atomic with the staged-value displacement.
  # Performing it later would allow concurrent squashes to re-add displaced
  # holder tokens and pin blobs until their TTL.
  @integration
  Scenario: A dedup squash leaves no phantom lease and never eagerly reclaims blobs
    Given a staged offloaded job with a dedup id
    When a second send with the same dedup id squashes it in place
    Then the replacement's lease is taken and the displaced lease is removed
    And a displaced blob is left to lazy backstop reclaim

  @integration
  Scenario: A squash chain never leaves a phantom lease
    Given a job squashed twice in succession under one dedup id
    When both squashes have completed
    Then only the final value's lease remains in its lease set
    And every displaced blob is left to lazy backstop reclaim

  # A squash configured not to replace the payload discards the NEW value, not
  # the stored one. The discarded value was never staged, so nothing may
  # take a lease for it. Its blob, when content-unique, is left
  # to the TTL backstop; when shared, the surviving job's lease keeps it alive.
  @integration
  Scenario: A squash that keeps the stored payload takes no lease for the discarded value
    Given a staged offloaded job whose dedup is configured to keep the stored payload
    When a second send with the same dedup id is squashed
    Then the stored job's lease is untouched
    And no lease is recorded for the discarded value

  @integration
  Scenario: A post-dispatch survive-dispatch squash takes no lease for the discarded value
    Given a dedup id whose job was already dispatched but whose survive-dispatch TTL is alive
    When a late re-trigger is squashed against it
    Then no lease is recorded for the discarded value
    And the discarded value's blob is left to the TTL backstop

  # ===========================================================================
  # tamper resistance and tenant isolation
  # ===========================================================================

  @unit @unimplemented
  Scenario: The read location is re-minted from (projectId, hash), not the stored ref
    Given an envelope whose stored ref.uri points at a different bucket than the project resolves to
    When the blob is read
    Then the read location is derived from the project's resolved destination and the content hash
    And the stored ref.uri is not used to locate the object

  @unit @unimplemented
  Scenario: A tampered ref cannot read another tenant's blob
    Given a tampered envelope carrying another tenant's projectId or uri
    When the blob is read
    Then the read is scoped to the owning project's namespace and destination
    And no cross-tenant object is returned

  @unit @unimplemented
  Scenario: Blob log lines are tenant-attributed and never leak the bucket
    Given a blob lease operation that fails
    When the failure is logged
    Then the log line carries the owning projectId and the content hash
    And it never logs a bare hash without its tenant
    And it never logs the raw object-store uri or bucket name

  # ===========================================================================
  # cluster-slot guard
  # ===========================================================================

  @unit @unimplemented
  Scenario: A queue name without a Redis hash tag is rejected at construction
    Given a GroupQueue constructed with a name lacking a hash tag
    When the queue is constructed
    Then construction fails fast with a clear error
    Because every key in the atomic lease transfer must share one cluster slot
