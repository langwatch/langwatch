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

  # Two-phase format rollout

  Scenario: Envelope writes stay off until the whole fleet reads envelopes
    Given envelope writes have not been enabled for the deployment
    When a job is staged
    Then the stored value is legacy bare JSON readable by the previous release
    And dispatch and the ops dashboard read it through the dual readers

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
