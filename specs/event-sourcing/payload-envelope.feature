# See dev/docs/adr/026-groupqueue-payload-envelope.md for the architectural rationale
Feature: GroupQueue payload envelope

  GroupQueue stores staged job payloads as a versioned envelope
  (routing header + optionally compressed body) so that dispatch-time
  pause checks and failure accounting read a tiny header instead of
  decoding the full payload, and so large span payloads occupy a
  fraction of the Redis memory of their raw JSON.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  # Envelope encoding

  Scenario: Large payloads are compressed at stage time
    When a job whose payload JSON exceeds the compression threshold is staged
    Then the stored value is an envelope with a gzip-encoded body
    And the envelope header carries the pipeline name, job type, and job name

  Scenario: Small payloads stay uncompressed
    When a job whose payload JSON is under the compression threshold is staged
    Then the stored value is an envelope with a raw JSON body

  Scenario: Incompressible payloads stay uncompressed
    When a staged payload would grow under gzip plus base64
    Then the stored value is an envelope with a raw JSON body

  # Large-payload blob offload
  #
  # NOTE (ADR-029): the blob-lifecycle scenarios in this section — cleanup on
  # complete, dedup-squash reclaim, the TTL safety net — describe the GQ1
  # mechanism (a private random-id blob per job, best-effort delete, 7-day
  # backstop). They are SUPERSEDED for envelope v2 by content-addressed sharing
  # + lease-based reclaim (ADR-046); see
  # specs/event-sourcing/payload-store-content-addressed.feature.

  Scenario: Very large payloads are offloaded out of the queue hash
    When a job whose payload exceeds the blob offload threshold is staged
    Then the body is stored under a standalone blob key as compressed binary
    And the queued value is a tiny envelope referencing the blob
    And the handler receives the payload intact

  # ADR-046: completion no longer deletes blobs; lifetime is a lease
  # (see payload-store-blob-lease.feature). Historic GQ1 delete-on-complete
  # behaviour applies only to values staged before the cutover.
  Scenario: Offloaded blobs expire via their lease after the job completes
    Given an offloaded job has been processed successfully
    Then its blob key expires when its lease elapses

  Scenario: Offloaded blobs displaced by a dedup squash are left to their lease
    Given a staged offloaded job
    When a later job with the same dedup id squashes it in place
    Then the surviving payload's blob resolves for the handler
    And the displaced payload's blob expires via its lease

  Scenario: A missing blob does not wedge the group
    Given an offloaded job whose blob has expired or been deleted
    When dispatch delivers it to the worker
    Then the job is completed without invoking the handler
    And the group continues processing subsequent jobs

  # Format rollout — the two-phase write gate was retired by ADR-046: writes
  # are unconditionally GQ2 envelopes, and the dual readers keep accepting
  # every format ever written (GQ2, GQ1, bare JSON).

  Scenario: Writes are always envelopes; readers accept every historic format
    When a job is staged
    Then the stored value is a GQ2 envelope
    And dispatch and the ops dashboard still read GQ1 and bare-JSON values staged by earlier releases

  Scenario: A staged payload round-trips through the envelope unchanged
    When a job is staged and later dispatched to its handler
    Then the handler receives a payload deep-equal to the one that was sent

  # Dispatch-time routing reads

  # Pause hold-back behaviour is owned by specs/queue-pausing/queue-pausing.feature;
  # this scenario specs only the mechanism (header-only read).
  Scenario: Pause checks read only the envelope header
    Given a pipeline is paused via the queue-pausing kill-switch
    When dispatch evaluates a staged job belonging to that pipeline
    Then the job is held back without decoding the payload body

  Scenario: Exhausted-retry accounting reads only the envelope header
    When a job exhausts its retries
    Then the per-job-name failed counter is incremented from the header

  # Backward compatibility

  Scenario: Legacy bare-JSON jobs staged before the deploy still process
    Given a job staged as plain JSON by a previous deployment
    When dispatch evaluates and delivers that job
    Then pause checks fall back to decoding the legacy JSON
    And the handler receives the original payload

  # Retry and coalescing paths

  Scenario: Retried jobs are re-staged as envelopes
    When a job fails with a retryable error
    Then the re-staged job is envelope-encoded with the attempt counter incremented

  Scenario: Drained coalesced siblings decode from envelopes
    Given a group with multiple due jobs and batch coalescing enabled
    When the dispatched job drains its siblings into one handler invocation
    Then every sibling payload is decoded from its envelope

  Scenario: A corrupt stored value does not wedge the group
    Given a staged value that is neither a valid envelope nor valid JSON
    When dispatch delivers it to the worker
    Then the job is completed without invoking the handler
    And the group continues processing subsequent jobs

  # Ops visibility

  Scenario: The ops dashboard shows routing fields for envelope jobs
    When the queue dashboard inspects a group's first pending job
    Then pipeline name, job type, and job name come from the envelope header
