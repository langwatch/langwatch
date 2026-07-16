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
  #   - body-PRESENT drop (malformed_envelope / body_unreadable / transient_exhausted
  #     / sibling_restage_failed): the value is intact, so it is PRESERVED in the
  #     job-scoped dead-letter AND named by the recovery key -> recoverable by drain.
  #   - missing_blob drop (the #5538 flagship: an evicted blob): the body is GONE.
  #     Nothing to preserve — the blob IS released, there is NO dead-letter entry.
  #     The recovery key rides the drop LOG only, so the otherwise-anonymous reactor
  #     loss (generateStagedJobId falls back to crypto.randomUUID() because a reactor
  #     payload {event, foldState} has no top-level .id) becomes addressable to its
  #     event_log row. This is NAMEABILITY, not recovery. Never say a missing_blob
  #     drop is "in the dead-letter" or "recovered".
  #
  # WHY A RECOVERY KEY AND NOT generateStagedJobId (#718): keying the staged-job id
  # on event.id would collapse two distinct reactor fires for the same event into
  # one staged slot — data-loss traded for data-loss. The key lives in the envelope
  # HEADER (header.k), alongside the routing trio p/t/n, so it survives blob loss in
  # both GQ1 and GQ2 tiers and never perturbs the GQ2 content hash.
  #
  # WHY THE DEAD-LETTER AND NOT parkPoisonGroup (#719): parking blocks the whole
  # group forever on a job that can never succeed; the dead-letter preserves the
  # value AND leaves the group live. The job-scoped move reuses the existing
  # group-scoped dlq:{groupId} key layout, so the operator's existing replayFromDlq
  # drain recovers it unchanged.
  #
  # WHY BLOB LIFETIME (#720): a body-present drop preserved in the dead-letter (7-day
  # TTL) references a blob whose own backstop is shorter (GQ2 ~4-5d; GQ1 7d but timed
  # from STAGING, so already ticking down at drop) — the blob would expire before the
  # quarantine window closes. Dead-lettering refreshes the blob/holder to outlive the
  # dead-letter entry, so preservation is real and not a reference to a gone blob.

  Background:
    Given a GroupQueue with jobs routed through queue-manager facades

  # ==================================================================
  # #718 — the recovery key: a drop is nameable back to its event
  # ==================================================================

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
  # AC-718.6 — the theme's end-to-end wire, through the REAL reactor facade (not a
  # test harness that injects machinery by hand). This is the one seam where a
  # mis-wire (reactor facade given the fold extractor p=>p.id) silently nulls the key
  # for every reactor job, because a reactor payload has no top-level .id.
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
  # AC-718.2b — THE FLAGSHIP. A body-GONE reactor drop is nameable but NOT preserved.
  Scenario: a missing-blob reactor drop is named in the log but not dead-lettered
    Given a reactor job whose payload event id is "evt-1"
    And the job's referenced blob is genuinely gone
    When a worker claims the group and the decode fails
    Then the drop log record carries the recovery key "evt-1"
    And the job is not written to the dead-letter
    And the staged value's blob holder is released

  @integration
  # AC-718.2 — a body-PRESENT reactor drop is BOTH preserved and named.
  Scenario: a body-present reactor drop is dead-lettered with its recovery key
    Given a reactor job whose payload event id is "evt-1"
    And the job's body is present but cannot be decoded
    When a worker claims the group and the decode fails
    Then the dead-letter entry for the job carries the recovery key "evt-1"

  @unit
  # AC-718.3 — like readJobRoutingMeta / readEnvelopeDescriptor, the reader never throws.
  Scenario Outline: reading a recovery key never throws
    Given a staged value that is "<shape>"
    When the staged value's recovery key is read
    Then the recovery key is absent
    And no error is thrown

    Examples:
      | shape                    |
      | legacy bare JSON         |
      | a malformed envelope     |
      | an empty string          |
      | an envelope with no key  |

  @unit @regression
  # AC-718.4 — the key must not perturb GQ2 dedup nor the staged-job id.
  Scenario: two events with different recovery keys but identical bodies still dedup to one blob
    Given two GQ2 jobs with identical bodies but recovery keys "evt-1" and "evt-2"
    When both are encoded
    Then both envelopes reference the same content-addressed blob
    And neither body carries the recovery key

  @unit @regression
  # AC-718.4 — the key rides header.k, never duplicated into header.m machinery.
  Scenario: a GQ2 recovery key lives in the header, not in the lifted machinery
    Given a GQ2 job whose payload event id is "evt-1"
    When it is encoded
    Then the envelope header recovery key is "evt-1"
    And the envelope's lifted machinery does not contain the recovery-key field

  @unit @regression
  # AC-718.4 — an id-bearing (fold) payload's staged-job id is unchanged by the key.
  Scenario: the staged-job id is unchanged by adding a recovery key
    Given an id-bearing payload with id "f-1"
    When its staged-job id is generated with and without a recovery key
    Then both staged-job ids equal "f-1"

  @integration @regression
  # AC-718.5 — the queue strips its own machinery before the handler runs. Proven on
  # GQ1, where INTERNAL_FIELDS is the ONLY strip (GQ2 also lifts it into the header).
  Scenario: the recovery-key machinery never reaches the handler
    Given a GQ1 reactor job whose payload event id is "evt-1"
    When the job is processed by its handler
    Then the handler's payload does not contain the recovery-key field

  @unit @regression
  # AC-718.7 — adding header.k is a wire-format change; every reader must still work.
  Scenario Outline: a header-key-bearing envelope still round-trips and still routes
    Given a "<tier>" envelope carrying a recovery key
    When the envelope is decoded
    Then the decoded body is identical to the original
    And the envelope descriptor still reports its format, version and blob id
    And the routing metadata still reads pipeline, job type and job name

    Examples:
      | tier |
      | GQ1  |
      | GQ2  |

  # ==================================================================
  # #719 — the job-scoped dead-letter: a body-present drop is preserved
  # ==================================================================

  @integration
  # AC-719.1
  Scenario: a body-present dispatch drop is moved to the dead-letter
    Given a staged job whose body is present but cannot be decoded
    When a worker claims the group and the decode fails
    Then the job's value is present in the group's dead-letter
    And the job's value is no longer in the live group data

  @integration
  # AC-719.2 — the missing-blob exemption: nothing to preserve.
  Scenario: a missing-blob drop is not moved to the dead-letter
    Given a staged job whose referenced blob is genuinely gone
    When a worker claims the group and the decode fails
    Then the job is not written to the dead-letter
    And the staged value's blob holder is released

  @integration
  # AC-719.3
  Scenario: a dead-letter entry is labelled with its drop reason
    Given a staged job whose body is present but cannot be decoded
    When a worker claims the group and the decode fails
    Then the dead-letter entry carries the classification reason

  @integration
  # AC-719.4
  Scenario: dead-lettering one job leaves the group live for its next job
    Given a group whose staged job cannot be decoded
    When a worker claims the group and the decode fails
    Then the group is not moved to the blocked set
    And the next job staged under the same group id dispatches normally

  @integration
  # AC-719.5 — the four body-present sites split by whether they own a slot. The two
  # slot-owning sites advance the slot as they dead-letter; the two no-slot sites
  # (a drained sibling is already out of staging) must NOT touch the live slot.
  Scenario Outline: every body-present discard site preserves the job in the dead-letter
    Given a job discarded by the "<site>" path with its body present
    When the discard happens
    Then the job's value is present in the group's dead-letter
    And the live group's active slot is "<active slot>"

    Examples:
      | site                  | active slot            |
      | dispatch decode       | advanced to next job   |
      | transient exhaustion  | advanced to next job   |
      | sibling-drain decode  | untouched              |
      | sibling re-stage      | untouched              |

  @integration
  # AC-719.7 — the move must be atomic with the removal from live staging: the value
  # exists in the dead-letter at the instant it leaves live data, or a crash/timing
  # window silently re-loses it — the original bug behind a green tick.
  Scenario: the dead-letter copy is durable before the live value is removed
    Given a staged job whose body is present but cannot be decoded
    When the job is dead-lettered
    Then at no point is the job's value absent from both the live group data and the dead-letter

  @integration
  # AC-719.6 — the operator's existing group-scoped drain recovers a job-scoped entry
  # unchanged, and the recovered job is byte-identical AND actually dispatchable.
  Scenario: draining the dead-letter restores the job to live staging and it dispatches
    Given a group with a dead-lettered body-present job
    When the operator drains the group's dead-letter
    Then the job's value is restored to live staging byte-identical
    And the restored job is dispatched to its handler

  # ==================================================================
  # #720 — blob lifetime: the preserved blob outlives the dead-letter window
  # ==================================================================

  @integration
  # AC-720.1 — GQ2. Asserted on the holder key (TTL 5d by default), which must be
  # refreshed to >= the dead-letter TTL measured from the drop.
  Scenario: a dead-lettered GQ2 job's blob holder outlives the dead-letter window
    Given a body-present GQ2 job with an acquired blob holder
    When the job is dead-lettered
    Then the blob holder's remaining lifetime is at least the dead-letter window

  @integration
  # AC-720.1b — GQ1. Its blob backstop is timed from STAGING, so at drop time it has
  # already ticked down below the dead-letter window unless refreshed.
  Scenario: a dead-lettered GQ1 job's blob outlives the dead-letter window
    Given a body-present GQ1 job whose blob was staged earlier
    When the job is dead-lettered
    Then the blob's remaining lifetime is at least the dead-letter window

  # ==================================================================
  # #721 — the guard: the false "recover via replay" premise cannot creep back
  # ==================================================================

  @unit
  # AC-721.6 — a guard that cannot disagree with its target is worthless, so the guard
  # is proven by a PLANTED violation that must redden it.
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

# --- AC Coverage Map ---
# #718 recovery key (naming)
#   AC-718.1  header.k readable after blob loss, both tiers
#     -> the recovery key is readable from the header after the blob is gone
#   AC-718.2  body-present reactor drop -> dead-letter carries the key
#     -> a body-present reactor drop is dead-lettered with its recovery key
#   AC-718.2b FLAGSHIP: missing_blob reactor drop -> LOG-only, nameable not recovered
#     -> a missing-blob reactor drop is named in the log but not dead-lettered
#   AC-718.3  reader never throws
#     -> reading a recovery key never throws
#   AC-718.4  no hash perturbation / no staged-id change / not duplicated into m
#     -> two events with different recovery keys but identical bodies still dedup to one blob
#     -> a GQ2 recovery key lives in the header, not in the lifted machinery
#     -> the staged-job id is unchanged by adding a recovery key
#   AC-718.5  stripped before the handler (proven RED on GQ1)
#     -> the recovery-key machinery never reaches the handler
#   AC-718.6  facade seam end-to-end (real QueueManager reactor + fold facades)
#     -> a reactor job staged through its facade carries its event id in the header
#     -> a fold job staged through its facade carries its event id in the header
#   AC-718.7  @regression wire-format: k-bearing envelope decodes/describes/routes
#     -> a header-key-bearing envelope still round-trips and still routes
#
# #719 job-scoped dead-letter (preservation)
#   AC-719.1 dispatch body-present -> dead-letter    -> a body-present dispatch drop is moved to the dead-letter
#   AC-719.2 missing_blob exemption                  -> a missing-blob drop is not moved to the dead-letter
#   AC-719.3 reason label                            -> a dead-letter entry is labelled with its drop reason
#   AC-719.4 group stays live                        -> dead-lettering one job leaves the group live for its next job
#   AC-719.5 four sites, slot vs no-slot             -> every body-present discard site preserves the job in the dead-letter
#   AC-719.7 atomic copy-before-remove               -> the dead-letter copy is durable before the live value is removed
#   AC-719.6 drain restores byte-identical+dispatch  -> draining the dead-letter restores the job to live staging and it dispatches
#
# #720 blob lifetime (keep-the-blob)
#   AC-720.1  GQ2 holder outlives DLQ window   -> a dead-lettered GQ2 job's blob holder outlives the dead-letter window
#   AC-720.1b GQ1 blob outlives DLQ window     -> a dead-lettered GQ1 job's blob outlives the dead-letter window
#   AC-720.2  not-reproduced trigger verdict — DOCUMENTATION (PR body + module doc); no CloudWatch access. Not scenario-mapped.
#   AC-720.3  #4760 false-premise flag — DOCUMENTATION (comment on #4760). Not scenario-mapped.
#
# #721 decision record + corrections
#   AC-721.6  replay-premise guard + self-test  -> the replay-premise guard fails on a discarding branch that claims replay recovery
#                                               -> the replay-premise guard passes on the corrected tree
#   AC-721.1  decision-record ADR enumerates rule/discriminator/trap — DOCUMENTATION (ADR). Not scenario-mapped.
#   AC-721.2  ADR-030 + ADR-029 corrected — DOCUMENTATION. Not scenario-mapped.
#   AC-721.3  migration 00026 corrected via NEW file, 00026 byte-unchanged — DOCUMENTATION + git-diff assertion. Not scenario-mapped.
#   AC-721.4  OCSF repository doc corrected — DOCUMENTATION. Not scenario-mapped.
#   AC-721.5  both ARCHITECTURE.md files corrected — DOCUMENTATION. Not scenario-mapped.
#
# DEFERRED to follow-ups (named, not overlooked): the reactor re-drive DRIVER +
# per-reactor replay-safety classification (~27 reactors across 3 pipelines); a
# standing CI guard that fails on ANY edit to a deployed migration (721.3 is
# point-in-time only); a harness invariant that pttl/deleted assertions require an
# explicitly acquired holder.
