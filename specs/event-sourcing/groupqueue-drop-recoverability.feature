Feature: GroupQueue drop recoverability — preserve, name, keep the blob
  As the LangWatch event-sourcing queue dispatching per-aggregate FIFO groups
  I want a discarded staged job to be preserved in an inspectable dead-letter and
  named by a recovery key that survives blob loss
  So that a drop stops being an unrecoverable, unnameable loss — a body-present
  drop can be drained and re-run, and even a body-gone reactor drop can be traced
  back to the exact event it lost.

  # Issues langwatch-saas#718 (recovery key), #719 (job-scoped dead-letter),
  # #720 (blob outlives the dead-letter window), #721 (decision record).
  # Continues #5821 (langwatch#edc6a3361), which made every drop NAMED and COUNTED
  # and stopped destroying body-present values. This makes drops RECOVERABLE.
  #
  # THE ONE DISTINCTION EVERY READER MUST HOLD (and the overclaim that got the
  # parent P1 challenged):
  #   - body-PRESENT drop: the value is intact, so it is PRESERVED in the
  #     job-scoped dead-letter AND named by the recovery key -> recoverable by drain.
  #   - missing_blob drop (the #5538 flagship: an evicted blob): the body is GONE.
  #     Nothing to preserve — the blob IS released, there is NO dead-letter entry.
  #     The recovery key rides the drop LOG only, so the otherwise-anonymous reactor
  #     loss (generateStagedJobId falls back to crypto.randomUUID() because a reactor
  #     payload {event, foldState} has no top-level .id) becomes addressable to its
  #     event_log row. This is NAMEABILITY, not recovery.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  # ================= #718 — the recovery key =================

  @unit
  # AC-718.1 — header.k survives what the body does not, in BOTH tiers.
  Scenario Outline: the recovery key is readable from the header after the blob is gone
    Given a reactor job "<tier>" whose payload event id is "evt-1"
    And the job's offloaded blob has been deleted
    When the staged value's recovery key is read
    Then the recovery key is "evt-1"

    Examples:
      | tier |
      | GQ1  |
      | GQ2  |

  @integration
  # AC-718.6 — the theme's end-to-end wire, through the REAL reactor facade. The one
  # seam where a mis-wire (fold extractor on the reactor facade) silently nulls the
  # key for every reactor job — a reactor payload has no top-level .id.
  Scenario: a reactor job staged through its facade carries its event id in the header
    Given a reactor registered on its pipeline
    When an event "evt-1" is dispatched to the reactor
    Then the staged envelope's recovery key is "evt-1"

  @integration
  # AC-718.6 companion — a fold job's recovery key is the bare event's own id.
  Scenario: a fold job staged through its facade carries its event id in the header
    Given a fold projection registered on its pipeline
    When an event "f-1" is dispatched to the fold
    Then the staged envelope's recovery key is "f-1"

  @integration
  # AC-718.2b — THE FLAGSHIP. A body-GONE reactor drop is nameable but NOT preserved:
  # no dead-letter entry, the blob is released, but the drop is named by the reason
  # and the recovery key rode the header into the drop log.
  Scenario: a missing-blob reactor drop is named in the log but not dead-lettered
    Given a reactor job whose payload event id is "evt-1"
    And the job's referenced blob is genuinely gone
    When a worker claims the group and the decode fails
    Then the job is not written to the dead-letter
    And the staged value's blob holder is released
    And the drop is recorded with the missing-blob reason

  @integration
  # AC-718.2 / AC-719.1 / AC-719.3 — a body-PRESENT reactor drop is BOTH preserved
  # (in the dead-letter, labelled with its reason, gone from live staging) and named
  # (the dead-letter entry carries the recovery key).
  Scenario: a body-present reactor drop is dead-lettered with its recovery key
    Given a reactor job whose payload event id is "evt-1"
    And the job's body is present but cannot be decoded
    When a worker claims the group and the decode fails
    Then the job's value is present in the group's dead-letter
    And the job's value is no longer in the live group data
    And the dead-letter entry is labelled with its drop reason
    And the dead-letter entry carries the recovery key "evt-1"

  @unit
  # AC-718.3 — like readJobRoutingMeta, the reader never throws.
  Scenario: reading a recovery key never throws
    Given a staged value that is legacy, malformed, empty, or keyless
    When the staged value's recovery key is read
    Then the recovery key is absent
    And no error is thrown

  @unit @regression
  # AC-718.4a — the key must not perturb GQ2 dedup.
  Scenario: two events with different recovery keys but identical bodies still dedup to one blob
    Given two GQ2 jobs with identical bodies but recovery keys "evt-1" and "evt-2"
    When both are encoded
    Then both envelopes reference the same content-addressed blob

  @unit @regression
  # AC-718.4b — the key rides header.k, never duplicated into header.m machinery.
  Scenario: a GQ2 recovery key lives in the header, not in the lifted machinery
    Given a GQ2 job whose payload event id is "evt-1"
    When it is encoded
    Then the envelope header recovery key is "evt-1"
    And the envelope's lifted machinery does not contain the recovery-key field

  @unit @regression
  # AC-718.7 — adding header.k is a wire-format change; every reader must still work.
  Scenario: a header-key-bearing envelope still round-trips and still routes
    Given a header-key-bearing envelope of either tier
    When the envelope is decoded and described
    Then the decoded body is identical to the original
    And the envelope descriptor still reports its format, version and blob id
    And the routing metadata still reads pipeline, job type and job name

  @unit @unimplemented
  # AC-718.4c — UNBOUND: generateStagedJobId is private and derives from the whole
  # payload; asserting its stability against __recoveryKey needs a seam that does not
  # exist yet. The key's non-interference is covered structurally (it is a header
  # field via routingHeader, never in the body). Tracked with the #718 follow-ups.
  Scenario: the staged-job id is unchanged by adding a recovery key
    Given an id-bearing payload with id "f-1"
    When its staged-job id is generated with and without a recovery key
    Then both staged-job ids equal "f-1"

  @integration @unimplemented
  # AC-718.5 — UNBOUND as a dedicated case: the GQ2 strip is exercised incidentally
  # by the drain round-trip (the handler payload has no __recoveryKey). A dedicated
  # GQ1-path strip test (where INTERNAL_FIELDS is the only strip) needs a GQ1-forcing
  # queue the current GQ2-only harness does not build. Tracked with the #718 follow-ups.
  Scenario: the recovery-key machinery never reaches the handler
    Given a GQ1 reactor job whose payload event id is "evt-1"
    When the job is processed by its handler
    Then the handler's payload does not contain the recovery-key field

  # ================= #719 — the job-scoped dead-letter =================

  @integration @unimplemented
  # AC-719.4 — UNBOUND as a dedicated DLQ case: group liveness after a drop is
  # covered for the non-DLQ path in groupqueue-decode-drop-durability.feature. A
  # DLQ-specific "next job dispatches after a body-present dead-letter" case is
  # tracked with the #719 follow-ups.
  Scenario: dead-lettering one job leaves the group live for its next job
    Given a group whose staged job is dead-lettered
    When a worker claims the group and the decode fails
    Then the group is not moved to the blocked set
    And the next job staged under the same group id dispatches normally

  @integration @unimplemented
  # AC-719.5 — UNBOUND: the two NO-SLOT sites (a drained sibling that fails to decode
  # / fails to re-stage) are WIRED to preserve via writeJobToDlq without complete(),
  # and the main coalesced-batch suite stays green, but a fault-injected per-site
  # assertion needs the coalesced-batch harness 5821 also deferred for these sites.
  Scenario Outline: every body-present discard site preserves the job in the dead-letter
    Given a job discarded by the "<site>" path with its body present
    When the discard happens
    Then the job's value is present in the group's dead-letter

    Examples:
      | site                 |
      | dispatch decode      |
      | transient exhaustion |
      | sibling-drain decode |
      | sibling re-stage     |

  @integration @unimplemented
  # AC-719.7 — UNBOUND, and SITE-SPECIFIC: the "value never absent from both live
  # staging and the dead-letter" invariant holds only at the copy-before-complete
  # sites (dispatch / transient exhaustion), where writeJobToDlq is awaited BEFORE
  # complete() frees the slot — so a rejected write or a crash leaves the value in
  # the live group. Asserting the instantaneous invariant there needs a crash-
  # injection seam the harness does not have. A DRAINED sibling has already left
  # staging and owns no slot to withhold, so it does NOT get this ordering — it
  # relies on the re-stage fallback below (AC-719.7b). Tracked with the #719 follow-ups.
  Scenario: the dead-letter copy is durable before the live value is removed
    Given a dispatched job whose body is present but cannot be decoded
    When the job is dead-lettered
    Then at no point is the job's value absent from both the live group data and the dead-letter

  @unit
  # AC-719.7b — the drained-sibling paths are NOT copy-before-complete (the value has
  # already left staging), so their durability is a re-stage FALLBACK: if the dead-letter
  # write fails, the raw value is re-staged into the live group rather than lost. Bound to
  # a seam unit test with real failure injection (falsifiable: drop the fallback and the
  # re-stage never happens).
  Scenario: a drained value whose dead-letter write fails is re-staged not lost
    Given a drained sibling being dead-lettered with its body present
    When the dead-letter write fails
    Then the raw value is re-staged into the live group

  @integration
  # AC-719.6 — the operator's existing group-scoped drain recovers a job-scoped entry
  # unchanged, byte-identical AND actually dispatchable (proving the key-layout reuse).
  Scenario: draining the dead-letter restores the job to live staging and it dispatches
    Given a group with a dead-lettered body-present job
    When the operator drains the group's dead-letter
    Then the job's value is restored to live staging byte-identical
    And the restored job is dispatched to its handler

  # ================= #720 — blob lifetime =================

  @integration
  # AC-720.1 — GQ2 holder TTL refreshed to at least the 7-day dead-letter window
  # (default 5 days). Falsifiability: disabling preserveForDlq drops it back to ~5d.
  Scenario: a dead-lettered GQ2 job's blob holder outlives the dead-letter window
    Given a body-present GQ2 job with an acquired blob holder
    When the job is dead-lettered
    Then the blob holder's remaining lifetime is at least the dead-letter window

  @integration @unimplemented
  # AC-720.1b — UNBOUND: the GQ1 blob-TTL extend is the same preserveForDlq code path
  # (the blobId branch), but staging a GQ1 (non-tiered) job needs a GQ1-forcing queue
  # the GQ2-only harness does not build. Tracked with the #720 follow-ups.
  Scenario: a dead-lettered GQ1 job's blob outlives the dead-letter window
    Given a body-present GQ1 job whose blob was staged earlier
    When the job is dead-lettered
    Then the blob's remaining lifetime is at least the dead-letter window

  # ================= #721 — the replay-premise guard =================

  @unit
  # AC-721.6 — a guard that cannot disagree with its target is worthless, so it is
  # proven by a PLANTED violation that must redden it.
  Scenario: the replay-premise guard fails on a discarding branch that claims replay recovery
    Given a discarding code branch annotated "recover via event replay"
    When the replay-premise guard runs
    Then the guard reports a violation

  @unit
  # AC-721.6 — and stays green on the corrected tree.
  Scenario: the replay-premise guard passes on the corrected tree
    Given the event-sourcing queue module as shipped
    When the replay-premise guard runs
    Then the guard reports no violation

# --- AC Coverage Map (bound = has an @scenario-tagged test; @unimplemented = specified, test deferred) ---
# #718: AC-718.1 bound; AC-718.6 bound (reactor + fold facade); AC-718.2b bound; AC-718.2/719.1/719.3 bound
#       (one body-present test); AC-718.3 bound; AC-718.4a/b bound; AC-718.7 bound.
#       AC-718.4c (@unimplemented, private generateStagedJobId); AC-718.5 (@unimplemented, GQ1-strip harness).
# #719: AC-719.6 bound (drain round-trip). AC-719.7b bound (drained-sibling re-stage fallback, seam unit test
#       with failure injection). AC-719.4/719.5/719.7 (@unimplemented — coalesced-batch / crash-injection harness
#       gaps, same class 5821 deferred; the no-slot sites are WIRED + typecheck-clean).
# #720: AC-720.1 bound (GQ2 holder, falsifiability-proven). AC-720.1b (@unimplemented, GQ1-forcing harness).
# #721: AC-721.6 bound (both guard directions). AC-721.1-.5 are documentation ACs (ADR-046 + site corrections
#       + migration 00042), verified by diff/review, not scenario-mapped.
