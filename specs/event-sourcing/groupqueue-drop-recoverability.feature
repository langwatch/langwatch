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

  @unit
  # AC-718.6 — the one seam where a mis-wire (fold extractor on the reactor facade)
  # silently nulls the key for every reactor job — a reactor payload has no
  # top-level .id. @unit, not @integration: the bound test drives the REAL
  # createFacade wiring but hands it a mocked shared queue, so it never reaches
  # Redis (test review, PR #5853 — it was tagged @integration and read as
  # end-to-end coverage it does not provide). A genuine end-to-end case would have
  # to dispatch through initializeReactorQueues into a real GroupQueueProcessor.
  Scenario: a reactor job staged through its facade carries its event id in the header
    Given a reactor registered on its pipeline
    When an event "evt-1" is dispatched to the reactor
    Then the staged envelope's recovery key is "evt-1"

  @unit
  # AC-718.6 companion — a fold job's recovery key is the bare event's own id.
  # @unit for the same reason as its sibling above: mocked shared queue, no Redis.
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

  @unit
  # AC-719.7c — the re-stage fallback above was the one re-stage in this class that
  # wrote the drained row's score back unguarded (review #5853). A legacy row scored
  # 0 was therefore rewritten at 0 on EVERY failed dead-letter write and never
  # healed, ordering it ahead of the job it was drained behind.
  Scenario: a re-staged drained value is never put back at an implausible score
    Given a drained sibling whose stored score is not a plausible timestamp
    When its dead-letter write fails and the raw value is re-staged
    Then the value is put back at the staging clock rather than its stored score

  @integration
  # AC-719.8 — a body-present drained sibling is dead-lettered with its blob kept alive
  # (#720); the DISPATCHED job of the same coalesced batch must not, on its success,
  # release that preserved blob — else a drain would recover a bodyless envelope. The
  # success-path release covers only the dispatched job + the siblings that folded into
  # the batch, never the dropped ones. Bound to a coalesced-batch integration test
  # (falsifiable: release every drained sibling and the sibling's blob is UNLINKed).
  Scenario: a dead-lettered drained sibling's blob survives the batch's success
    Given a coalesced batch whose drained sibling is dead-lettered with its body present
    When the dispatched job succeeds
    Then the dropped sibling's preserved blob is not reclaimed

  @integration
  # AC-719.6 — the operator's existing group-scoped drain recovers a job-scoped entry
  # unchanged, byte-identical AND actually dispatchable (proving the key-layout reuse).
  Scenario: draining the dead-letter restores the job to live staging and it dispatches
    Given a group with a dead-lettered body-present job
    When the operator drains the group's dead-letter
    Then the job's value is restored to live staging byte-identical
    And the restored job is dispatched to its handler

  # ----- the dead-letter's operator surface -----
  # Dead-lettering used to be a rare whole-group operator action, usually followed
  # by a replay. It is now automatic and per-job on a path documented at 100+/day,
  # under a per-aggregate group id that is never reused — so the dead-letter's
  # OWN accounting has to survive the quarantine window ending, or the signal that
  # says "there is something in the dead-letter" stops meaning anything.

  @integration
  # AC-719.9 — the badge is the operator's primary signal, so it has to be able to
  # come back down. Falsifiability: stop sweeping and it counts groups whose
  # payload expired days ago, so it only ever goes up.
  Scenario: the dead-letter count returns to zero once the dead-lettered payloads have expired
    Given a group with a dead-lettered body-present job
    When the quarantine window has passed and the operator checks the dead-letter count
    Then the dead-letter count is zero
    And the queue no longer tracks the expired dead-letter at all

  @integration
  # AC-719.10 — and the page agrees with the badge, because both read the same way.
  Scenario: an expired dead-letter is no longer offered to the operator to act on
    Given a group with a dead-lettered body-present job
    When the quarantine window has passed and the operator lists the dead-lettered groups
    Then the expired group is not listed
    And the queue no longer tracks the expired dead-letter at all

  @integration
  # AC-719.11 — the false-positive guard, and the reason the predicate is what it
  # is. Hiding a dead-letter the operator could still act on is worse than keeping
  # a stale entry, and a group dead-lettered with nothing pending still carries the
  # record of why it died. Falsifiability: judge liveness by recoverable jobs alone
  # and the second example disappears from both the count and the list.
  Scenario Outline: a dead-letter the operator can still act on is never swept away
    Given a dead-lettered group that still has "<remaining>"
    When the operator checks the dead-letter count and lists the dead-lettered groups
    Then the group is counted and listed with what it still has
    And the queue still tracks it

    Examples:
      | remaining                      |
      | a recoverable job              |
      | only the record of why it died |

  @integration
  # AC-719.12 — the count is a count of groups, not of sightings: the dead-letter
  # can report the same group more than once while it is being read through.
  Scenario: the dead-letter total counts a group once even if the scan surfaces it twice
    Given a dead-lettered group the queue surfaces on two consecutive pages
    When the operator checks the dead-letter count and lists the dead-lettered groups
    Then the group is counted once and listed once

  @unit
  # AC-719.13 — THE DROP TALLY MUST NOT COUNT WORK STILL IN THE QUEUE. When the
  # dead-letter write for a drained value fails, the value is put back into the
  # live group — a designed durability fallback (AC-719.7b), on which nothing was
  # thrown away. The tally used to be claimed BEFORE that attempt, so it counted a
  # job that was still there. Falsifiability: claim the drop before the attempt
  # again (or fold the put-back branch into it) and the tally reads 1.
  Scenario: a discard tally does not count a job the queue put back
    Given a drained job whose dead-letter write fails and is put back into the live group
    When the operator reads how many jobs the queue has discarded
    Then no discard is counted for it
    And the put-back is reported separately so an operator can tell the two apart

  @unit
  # AC-719.14 — the unbounded-inflation case, and the reason AC-719.13 is worth a
  # scenario of its own. A put-back value is handed to the NEXT drain, so a
  # dead-letter write that keeps failing meets the same job over and over. One
  # stuck job must not be able to run the discard tally up without limit.
  # Falsifiability: count the put-back as a discard and the tally reads once per
  # cycle instead of zero.
  Scenario: a repeatedly failing dead-letter write does not inflate the discard tally
    Given a drained job the queue keeps failing to dead-letter across several cycles
    When the operator reads how many jobs the queue has discarded
    Then no discard is counted for it
    And the put-back is reported once per cycle

  @unit
  # AC-719.15 — the other direction, so AC-719.13 cannot be satisfied by simply
  # never counting these sites. When the put-back ALSO fails the job really is
  # gone, and it must be counted as a discard whose body did not survive.
  Scenario: a drained job that can be neither dead-lettered nor put back is counted as lost
    Given a drained job whose dead-letter write and put-back both fail
    When the operator reads how many jobs the queue has discarded
    Then the discard is counted for it
    And it is recorded as a discard whose body did not survive

  @unit
  # AC-719.17 — the positive control AC-719.13-.15 need: a dead-letter write that
  # actually SUCCEEDS is the real discard, and it must never also be reported as a
  # put-back — they are mutually exclusive readings of one attempt. Falsifiability:
  # drop the recordDrop call from the dead_lettered branch (or route it into the
  # put-back counter instead) and the discard reads 0 while the put-back total
  # climbs to 1 for a write that never failed.
  Scenario: a successful dead-letter write is counted as a discard and never as a put-back
    Given a drained job whose dead-letter write succeeds
    When the operator reads how many jobs the queue has discarded
    Then the discard is counted for it
    And no put-back is reported for it

  # ----- telling a recoverable dead-letter from one that will come back empty -----

  @unit
  # AC-720.3 — the dead-letter is written whether or not the body's lifetime was
  # actually extended, so the entry has to say which. An operator draining a
  # dead-letter otherwise finds out by draining it and watching it fail. Bound at
  # the seam that DECIDES the verdict; AC-719.16 is where it is read back off the
  # entry an operator actually looks at. Falsifiability: report every entry as
  # preserved and the third example reads the same as the first two.
  Scenario Outline: a dead-lettered job says whether its body is still expected to be there
    Given a dead-lettered job whose body is "<body state>"
    When the job is dead-lettered
    Then the dead-letter records that the body "<verdict>"

    Examples:
      | body state                             | verdict          |
      | held for the quarantine window         | is expected      |
      | carried inside the entry itself        | is expected      |
      | referenced but not held for the window | may not be there |

  @unit
  # AC-720.4 — a body-present drop whose value claims an offloaded body the queue
  # cannot find a reference to used to be the one path here that produced NO
  # signal at all: no extension, no log line, and an entry that read as preserved.
  # A never-offloaded body must NOT raise the same alarm — it is the common case
  # and it is fully recoverable — so the two are distinguished, not merged.
  Scenario Outline: a dead-letter whose body cannot be held is not written in silence
    Given a dead-lettered job whose value "<claim>"
    When the dead-letter is written
    Then the queue "<signal>"

    Examples:
      | claim                                   | signal                               |
      | claims a stored body it cannot point at | warns that the body may not be there |
      | cannot be read at all                   | warns that the body may not be there |
      | carries its own body                    | stays quiet — nothing is at risk     |

  @integration
  # AC-719.16 — the entries this change creates are the automatic, high-frequency
  # ones, and they were the least visible on the surface built to recover them:
  # carrying no summary or time of death, they sorted BELOW every group an operator
  # had moved by hand, with no text to identify them. Falsifiability: drop the
  # group-level fields and the automatic entry sorts last with an empty error.
  Scenario: an automatically dead-lettered job is as visible to the operator as a hand-moved group
    Given a group dead-lettered automatically by a drop and an older group moved by an operator
    When the operator lists the dead-lettered groups
    Then both are described by why they died and when
    And the automatic one is listed first because it happened most recently

  # ================= #720 — blob lifetime =================

  @integration
  # AC-720.1 — GQ2 holder TTL refreshed to at least the 7-day dead-letter window.
  # Falsifiability: disabling preserveForDlq drops it back to the routine backstop.
  Scenario: a dead-lettered GQ2 job's blob holder outlives the dead-letter window
    Given a body-present GQ2 job with an acquired blob holder
    When the job is dead-lettered
    Then the blob holder's remaining lifetime is at least the dead-letter window

  @integration
  # AC-720.2 — a dead-letter hold must survive the ORDINARY path, not just the drop
  # path. Blobs are content-addressed, so a sibling job with an identical body shares
  # the lease set; plain EXPIRE is last-writer-wins, so that sibling's routine renew
  # pulled the 7-day hold back to the 4-day backstop and the sweep then reclaimed the
  # bytes ~3 days before the dead-letter entry expired. Falsifiability: reverting the
  # arming expiries to plain EXPIRE reddens this at 345600s (exactly 4 days).
  Scenario: an ordinary sibling renew cannot shorten a dead-letter hold
    Given a dead-lettered blob that a sibling job still holds an ordinary lease on
    When the sibling renews its ordinary lease
    Then the quarantine window is left intact rather than pulled back to the routine backstop

  @unit
  # AC-720.1b — bound at unit level (review #5853). Staging a real GQ1 job still needs
  # a GQ1-forcing queue the GQ2-only integration harness does not build, but the branch
  # this AC exists for turned out to be a live defect rather than a coverage gap: the
  # drop path extended the GQ1 blob, stamped the entry `extended`, and then released
  # the lease — which for GQ1 is an unconditional delete. Bound to the preserve→release
  # round trip against a stubbed blob store, which is where that contradiction lives.
  Scenario: a dead-lettered GQ1 job's blob outlives the dead-letter window
    Given a body-present GQ1 job whose blob was staged earlier
    When the job is dead-lettered and its lease is released
    Then the blob is still there for the dead-letter that references it

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
# #719: AC-719.6 bound (drain round-trip). AC-719.8 bound (dead-lettered sibling's blob survives the batch
#       success — coalesced-batch integration test). AC-719.7b bound (drained-sibling re-stage fallback, seam unit test
#       with failure injection). AC-719.9/.10/.11/.12 bound (the dead-letter's operator surface: the count and the
#       list sweep expired index members instead of counting them forever, keep every entry that still holds a
#       recoverable job OR the record of why the group died, and count each group once across a paged scan —
#       falsifiability-proven per scenario). AC-719.13/.14/.15 bound (the discard tally counts only discards: a
#       put-back drained value is NOT one and is reported separately, a repeatedly-failing dead-letter write cannot
#       inflate the tally once per cycle, and a value that can be neither dead-lettered nor put back still counts as
#       a body-gone discard — the same seam unit test with failure injection). AC-719.17 bound (the positive control:
#       a dead-letter write that succeeds is itself counted as the discard and never as a put-back — same seam unit
#       test). AC-719.16 bound (an automatically dead-lettered job is as visible and as well ordered on the
#       operator's list as a hand-moved group).
#       AC-719.4/719.5/719.7 (@unimplemented — coalesced-batch /
#       crash-injection harness gaps, same class 5821 deferred; the no-slot sites are WIRED + typecheck-clean).
# #720: AC-720.1 bound (GQ2 holder, falsifiability-proven). AC-720.2 bound (an ordinary sibling renew
#       cannot shorten a dead-letter hold — the ORDINARY path, found in review; falsifiability-proven).
#       AC-720.3/.4 bound (the entry states whether its body is still expected to be there, and the one path that
#       could not hold a claimed body in total silence now warns — while a never-offloaded body stays quiet).
#       AC-720.1b bound at unit level (the GQ1 preserve->release round trip; a real GQ1 staging
#       harness is still absent, but the branch it guards is now covered where the defect lived).
# #721: AC-721.6 bound (both guard directions). AC-721.1-.5 are documentation ACs (ADR-081 + site corrections
#       + the 00026 OCSF replay-coverage correction migration), verified by diff/review,
#       not scenario-mapped.
