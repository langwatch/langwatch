Feature: GroupQueue ready-score integrity
  As an operator reading the group queue's age gauges
  I want a ready score that is always a real occurrence time
  So that a producer with a broken score function cannot rank its jobs ahead of
  everything else, and cannot make a gauge report decades of backlog.

  # why this exists
  #
  # gq_oldest_pending_age_milliseconds reported ~1.786e12 ms (about 56 years) in
  # production on 2026-07-31 14:00-15:00 and 2026-08-03 12:00-13:00 UTC. the
  # Events Backed Up alert reads max(...)/1000, so every one of those samples was
  # a guaranteed spurious fire.
  #
  # the arithmetic: for each sample, scrape_timestamp_ms - reported_value was
  # 315,969 / 339,017 / 357,120 ms, i.e. a ready score of roughly 2 to 57,000 - a
  # few seconds after the Unix epoch, plus the pipeline delay. not epoch-seconds,
  # not the unblock sentinel (1), and not the empty-queue case (the collector
  # already reports 0 for that).
  #
  # the mechanism was `??`. queueManager's standalone-job score function returned
  # `payload.occurredAt ?? 0` and GroupQueue.send coalesced with
  # `this.score?.(payload) ?? Date.now()`. `??` passes 0 and NaN, so a payload
  # with no occurrence time staged at the epoch and stayed the oldest thing in
  # the queue forever.
  #
  # three layers, because each one alone leaves the class open:
  #   1. the producer chooses a meaningful fallback (now, not 1970)
  #   2. GroupQueue validates whatever a score function returns
  #   3. the gauges refuse to read a score that cannot be a timestamp, and count
  #      what they refused
  #
  # this removes one specific false signal. it does NOT quieten Events Backed Up:
  # the gauge is legitimately enormous much of the time, because parked and
  # future-scheduled groups inflate it, as the rule's own annotation says.
  #
  # MIN_PLAUSIBLE_EPOCH_MS = 1_600_000_000_000 (2020-09-13), years before this
  # queue existed and far above every accidental score we have seen. companion
  # to gq_oldest_backlog_age_milliseconds, which clocks off the per-group jobs
  # zset and is floored the same way.

  Rule: a producer with no occurrence time means "now", not 1970

    @unit
    Scenario: a standalone job with no occurrence time is scored at the current time
      Given a standalone job registered without its own score function
      When the queue scores a payload that carries no occurrence time
      Then the score is the current time
      And a payload that does carry an occurrence time keeps it

    @unit
    Scenario: a command with no occurrence time is scored at the current time
      Given a command that is not serialized by aggregate
      When the queue scores a payload that carries no occurrence time
      Then the score is the current time

  Rule: GroupQueue validates every score a producer hands it

    @unit
    Scenario: a score that is not a plausible timestamp falls back to the current time
      Given a score function that returns 0, NaN, nothing, or a value in epoch seconds
      When the queue resolves the ready score
      Then the resolved score is the current time

    @unit
    Scenario: a plausible timestamp is staged unchanged
      Given a score function that returns a real epoch-milliseconds timestamp
      When the queue resolves the ready score
      Then the resolved score is that timestamp, untouched

    @unit
    Scenario: a batch that falls back keeps its arrival order
      Given a batch of payloads whose scores are all unusable
      When the queue resolves each ready score against one shared clock reading
      Then every fallback score is identical, so the per-index tiebreak orders them

  Rule: the age gauges cannot report an age that predates the queue

    @unit
    Scenario: the oldest-pending-age gauge skips a score from just after the Unix epoch
      Given a ready group scored a few seconds after the Unix epoch
      When queue metrics are collected
      Then the oldest-pending-age gauge does not report that group's age
      And the ready-set probe reads from the plausible-epoch floor upwards

    @unit
    Scenario: an implausible ready score raises a counter instead of being swallowed
      Given a ready group scored below the plausible-epoch floor
      When queue metrics are collected
      Then the implausible-ready-score counter is raised for that queue

    @unit
    Scenario: the unblock sentinel is not counted as an implausible score
      Given a just-unblocked group carrying the unblock sentinel score
      When queue metrics are collected
      Then the implausible-ready-score counter stays where it was
      And the oldest-pending-age gauge reports 0
