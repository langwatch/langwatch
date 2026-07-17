Feature: GroupQueue decode-drop durability and attribution
  As the LangWatch event-sourcing queue dispatching per-aggregate FIFO groups
  I want a staged job that cannot be decoded to be named, counted, and — when its
  body is still there — preserved rather than deleted
  So that a job we cannot process stops being an unattributable loss that ops
  reads as a success, and so that a body a later worker could have decoded is
  not destroyed on the way out.

  # Issue #5538. Prod: "Failed to parse staged job data" 100+ times in ~31h across
  # 12 reactors, biggest single loser scenario simulation runs.
  #
  # WHY THIS IS P1, and the thing every reader gets wrong:
  #   Every discarding path in this module is justified by "recover via event
  #   replay". For reactor-bearing folds that claim is FALSE. The replay service
  #   rebuilds fold projections and never invokes reactors (projectionRouter.ts
  #   :61-71); replay's only reactor references (replayMarkers.ts:117,
  #   replayMapPath.ts:408) exist to SUPPRESS re-fires. governanceOcsfEventsSync
  #   (OCSF security/audit) and gatewayBudgetSync (billing) are both registered
  #   via builder.withReactor("traceSummary", ...) — on a fold, where replay
  #   never reaches them. So a dropped audit or billing event is permanently
  #   lost. Scoped honestly: fold/map drops ARE replay-covered (replayService.ts
  #   :74,105 drives mapProjections) — the falsity is reactor-specific.
  #
  #   Do not confuse this with idempotency. Both reactors cite a
  #   ReplacingMergeTree key as their "idempotency" — that makes a SECOND firing
  #   harmless, but nothing produces a second firing.
  #
  # Design, and the two traps it steps around:
  #   - DO NOT PARK. parkPoisonGroup/restageAndBlock blocks the whole group.
  #     Correct for oversized_payload (value intact; a raised cap could process
  #     it). Wrong here: a missing blob never returns, so parking freezes that
  #     aggregate forever on a job that can never succeed. At 100+/day those
  #     accumulate into an availability incident.
  #   - (Historic, pre-ADR-046) DO NOT release() A BODY THAT IS STILL THERE:
  #     under leases nothing releases at all — a preserved body simply lives
  #     to its lease. The original rationale: release() "reclaim[s] the
  #     blob ... deleting an s3 object out-of-band" — this module's
  #     retired-forever signal. handleTransientDecode already refuses it
  #     (:1492-1494 "releasing here would risk reclaiming the blob the re-stage
  #     still needs"). The drop path fires it on body-present failures — i.e. on
  #     rolling-deploy format skew, where the NEXT worker could have decoded the
  #     body fine. That is active destruction of recoverable data.
  #
  # Scope (Option A). This spec makes every loss named, counted, and
  # non-destructive. It does NOT make missing-blob drops recoverable — that body
  # is genuinely gone, and that loss is irreducible at this layer. Fully
  # discharging durability for reactor jobs needs a re-fire key + driver, split
  # to follow-ups: reactor jobs stage {event, foldState} with no top-level .id,
  # so generateStagedJobId falls back to crypto.randomUUID() and the event id
  # exists only inside the lost blob. You cannot drive what you cannot name.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  # --- AC1: diagnosability — the descriptor half (the err half shipped in #5736)

  @integration @unimplemented
  # UNBOUND, deliberately and visibly (#5538). The descriptor READER is proven by
  # `readEnvelopeDescriptor` unit tests below (incl. that it still reports after
  # the blob is gone, and never throws). What is NOT asserted is the last inch:
  # that `recordDrop` puts those fields on the emitted log record. That needs a
  # logger-capture harness the groupQueue integration suite does not have yet.
  # Tracked by #5817. Do not read the green suite as covering this.
  Scenario: a non-transient decode failure names the envelope it could not read
    Given a staged job whose decode throws a non-transient error
    When a worker claims the group and the decode fails
    Then the drop log carries the envelope format and version
    And the drop log carries the blob hash when the envelope referenced a blob
    And the drop log carries no raw payload and no tenant PII

  # --- AC2: preserve AND count (a counter alone is NOT sufficient)

  @integration
  Scenario: a body-present decode failure does not destroy the body it could not read
    Given a staged job whose body is present but cannot be decoded
    When a worker claims the group and the decode fails
    Then no code path deletes the blob (ADR-046: nothing releases; lifetime is the lease)
    And the body is still readable from the blob store afterwards

  @integration
  Scenario: a missing-blob drop is recorded as an irreducible loss
    Given a staged job whose referenced blob is genuinely gone
    When a worker claims the group and the decode fails
    Then the drop is recorded as an irreducible loss rather than a preserved body

  @integration
  Scenario: a drop names which pipeline and job lost the event
    Given a staged job whose decode throws a non-transient error
    When a worker claims the group and the decode fails
    Then the drop counter increments once
    And the drop counter identifies the queue, pipeline, job type and job name
    And the drop counter carries the classification reason

  @integration
  Scenario: a decode failure leaves the group live for its next job
    Given a group whose staged job cannot be decoded
    When a worker claims the group and the decode fails
    Then the group is not moved to the blocked set
    And the next job staged under the same group id dispatches normally

  # --- AC3: classification is structured, not free-text

  @unit
  Scenario: an envelope whose referenced blob is gone is classified as a missing blob
    Given an envelope referencing a blob that resolves to nothing
    When the envelope is decoded
    Then the failure carries the missing-blob reason

  @unit
  Scenario: an envelope that cannot be parsed is classified as malformed
    Given an envelope whose header or body structure is invalid
    When the envelope is decoded
    Then the failure carries the malformed-envelope reason

  @unit
  Scenario: a body that cannot be read back is classified as body-unreadable
    Given an envelope whose compressed body is corrupt
    When the envelope is decoded
    Then the failure carries the body-unreadable reason

  @integration
  Scenario: classification survives an exception message it does not own
    Given a staged job whose body fails to decompress
    When a worker claims the group and the decode fails
    Then the emitted reason is derived from the failure type
    And distinguishing the failure classes needs no substring match on the exception text

  # --- AC4: @regression — every supported format still decodes

  @integration @unimplemented
  # UNBOUND by choice: every format here is already covered by the existing
  # jobEnvelope suites (34 tests, green on this branch — bare JSON, gz, GQ1+blob,
  # GQ2+blob; zstd/msgpack via jobEnvelope.codec.unit.test.ts). Re-binding them to
  # this outline would duplicate coverage the spec step forbids. What is NOT yet
  # asserted is the drop counter staying ZERO across a clean run of all formats.
  Scenario Outline: a well-formed envelope of every supported format still decodes
    Given a well-formed staged job encoded as <format>
    When a worker claims the group
    Then the job is processed by its handler
    And the drop counter does not increment

    Examples:
      | format             |
      | bare JSON          |
      | gzip inline        |
      | GQ1 with its blob  |
      | GQ2 with its blob  |
      | zstd               |
      | msgpack            |

  # --- AC5: @regression — transient retries, AND its terminal is counted

  @integration
  Scenario: a transient blob-store error still retries instead of dropping
    Given a staged job whose blob store is temporarily unreachable
    When a worker claims the group and the decode fails
    Then the job is re-staged for retry rather than completed
    And the drop counter does not increment

  @integration
  Scenario: the transient retry ladder's terminal counts the job it gives up on
    Given a staged job whose blob store stays unreachable for every retry attempt
    When the job exhausts its retry budget
    Then the drop counter increments with the transient-exhausted reason
    And the operator is not told the event will be recovered by replay

  # --- AC7: all four discarding sites; the false replay premise removed

  @integration @unimplemented
  # UNBOUND as an outline: no single test drives all five sites. Honest count is
  # 3 of 5 covered individually — dispatch decode, transient exhaustion, and (added
  # after a test review caught it uncovered AND undisclosed) retry re-encode. AC8's
  # pair exercises the SAME dispatch-decode site under a different AC — not a
  # fourth. Still uncovered: sibling-drain decode and sibling re-stage, which need
  # fault injection layered on the coalesced-batch harness that already exists in
  # groupQueue.integration.test.ts. The "no path claims replay recovery" half is
  # proven by AC7's grep rather than by an executing test. Tracked by #5817.
  Scenario Outline: every path that discards a job counts the loss
    Given a job that is discarded by the <site> path
    When the discard happens
    Then the drop counter increments with that path's reason
    And no operator-visible message claims the event recovers via replay

    Examples:
      | site                    | covered by an executing test? |
      | dispatch decode         | yes                           |
      | transient exhaustion    | yes                           |
      | sibling-drain decode    | no — needs fault injection on the coalesced-batch harness |
      | sibling re-stage        | no — same                     |
      | retry re-encode         | body left to its lease: already read, nothing to preserve for later  |

  # --- AC8: a drop is not counted as a success

  @integration
  Scenario: a dropped job is not counted as a completed job
    Given a group whose completed-jobs count is known
    When a worker claims the group and the staged job is dropped on decode failure
    Then the completed-jobs count is unchanged

  @integration
  Scenario: a dropped job does not erase the group's recorded error
    Given a group carrying a recorded error from a previous failure
    When a worker claims the group and the staged job is dropped on decode failure
    Then the group's recorded error survives the drop

# --- AC Coverage Map ---
# AC1 "drop log includes a safe envelope descriptor (header.e/header.v + blob hash), never raw payload or tenant PII"
#   -> Scenario: a non-transient decode failure names the envelope it could not read
#
# AC2(a) "body-present failures do not destroy the body (ADR-046: nothing releases)"
#   -> Scenario: a body-present decode failure does not destroy the body it could not read
#   -> Scenario: a missing-blob drop is recorded as an irreducible loss
# AC2(b) "every drop counted, labelled {queue_name, pipeline_name, job_type, job_name, reason}"
#   -> Scenario: a drop names which pipeline and job lost the event
# AC2(c) "liveness preserved — the group is not blocked"
#   -> Scenario: a decode failure leaves the group live for its next job
#
# AC3 "structured closed-enum reason derived from error TYPE, never message-text matching"
#   -> Scenario: an envelope whose referenced blob is gone is classified as a missing blob
#   -> Scenario: an envelope that cannot be parsed is classified as malformed
#   -> Scenario: a body that cannot be read back is classified as body-unreadable
#   -> Scenario: classification survives an exception message it does not own
#
# AC4 "@regression — bare JSON / gz / GQ1+blob / GQ2+blob / zstd / msgpack still decode; counter stays zero"
#   -> Scenario Outline: a well-formed envelope of every supported format still decodes
#
# AC5(a) "@regression — TransientBlobStoreError still routes to handleTransientDecode, not swallowed"
#   -> Scenario: a transient blob-store error still retries instead of dropping
# AC5(b) "the exhaustion terminal (:1511-1525) counts reason=transient_exhausted, drops the replay claim"
#   -> Scenario: the transient retry ladder's terminal counts the job it gives up on
#
# AC7 "all four discarding sites counted; no discarding path claims replay recovery"
#   -> Scenario Outline: every path that discards a job counts the loss
#      (dispatch decode :803 / sibling-drain decode :1300 / sibling re-stage :1337 /
#       transient exhaustion :1520 — three of which emit the false claim to PROD LOGS)
#
# AC8 "a drop increments neither stats:completed nor clears the group error key"
#   -> Scenario: a dropped job is not counted as a completed job
#   -> Scenario: a dropped job does not erase the group's recorded error
#
# AC6 — NOT MAPPED BY DESIGN. Moved to a follow-up issue: it is conditional on prod
#   exception text (no CloudWatch access from the implementing environment), and the
#   AC1/AC3 instrumentation THIS issue ships is what produces that evidence. Gating on
#   it would deadlock the fix that generates its own evidence.
