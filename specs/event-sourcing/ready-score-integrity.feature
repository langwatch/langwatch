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
  # the queue forever. deferredOriginResolution is the producer: no occurredAt
  # on its payload, and a 5-minute delay, giving a ready score of exactly
  # 300,000 - which the three residuals above resolve to, leaving 16.0s / 39.0s
  # / 57.1s of collect-to-scrape lag against a 15s collector interval.
  #
  # three layers, because each one alone leaves the class open:
  #   1. the producer scores an ABSENT occurrence time at now, and hands a
  #      supplied one over untouched so the queue can judge and report it
  #   2. GroupQueue bounds every score two-sided against the staging clock
  #   3. the gauges refuse to read a score that is not a timestamp at all
  #
  # this removes one specific false signal. it does NOT quieten Events Backed Up:
  # the gauge is legitimately enormous much of the time, because parked and
  # future-scheduled groups inflate it, as the rule's own annotation says.
  #
  # bounds: MAX_SCORE_PAST_SKEW_MS (24h) and MAX_SCORE_FUTURE_SKEW_MS (5min),
  # both relative to the staging clock, plus MIN_PLAUSIBLE_EPOCH_MS
  # (1_600_000_000_000, 2020-09-13) as the absolute backstop the relative bounds
  # cannot provide - a worker that boots before its NTP sync reads Date.now() in
  # 1970 and every score is then "plausible" relative to that. companion to
  # gq_oldest_backlog_age_milliseconds, which clocks off the per-group jobs zset
  # and applies the same backstop.

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

  Rule: GroupQueue judges every score against the clock it is staging on

    # the bound is two-sided and RELATIVE, not a fixed floor. the score for the
    # highest-volume producers is a customer-supplied OTLP timestamp, whose
    # domain is unbounded in both directions, so a constant is the wrong shape:
    # a tenant shipping logs stamped 2021-01-01 clears any floor and still reads
    # as years of backlog, and a tenant whose clock says 2030 stages a group
    # that dispatch cannot see until 2030 while its jobs count against
    # totalPending. same vocabulary as MAX_ANCHOR_FUTURE_SKEW_MS /
    # isUsableAnchorMs in traceAnalytics.foldProjection.ts (ADR-071).

    @unit
    Scenario: a score outside the allowed skew around now falls back to the staging time
      Given a score function that returns 0, NaN, a value in epoch seconds, a timestamp years in the past, or a clock years in the future
      When the queue resolves the ready score
      Then the resolved score is the staging time
      And the queue reports the producer's score as rejected

    @unit
    Scenario: a plausible timestamp is staged unchanged
      Given a score function that returns a timestamp inside the allowed skew
      When the queue resolves the ready score
      Then the resolved score is that timestamp, untouched

    @unit
    Scenario: a payload with no occurrence time is scored at the staging time without being reported
      Given a payload that carries no occurrence time at all
      When the queue resolves the ready score
      Then the resolved score is the staging time
      And nothing is reported, because scoring it now is the designed default

    @unit
    Scenario: a supplied occurrence time reaches the queue unrepaired
      Given a producer that supplies an occurrence time the queue will reject
      When the score function runs
      Then it hands the value over untouched
      And the queue is what repairs it, so the counter can name the queue

    @unit
    Scenario: a fallback taken from an unsynchronised clock is itself bounded
      Given a worker whose clock has not yet synchronised and reads 1970
      When the queue falls back to that clock
      Then the fallback is pinned to the plausible-epoch backstop

    @unit
    Scenario: a batch that falls back keeps its arrival order
      Given a batch of payloads whose scores are all unusable
      When the queue resolves each ready score against one shared clock reading
      Then every fallback score is identical, so the per-index tiebreak orders them

    @integration
    Scenario: a job staged with an unusable score dispatches behind one that occurred earlier
      Given a group holding a job whose score function returns 0 and a job that occurred a minute ago
      When the group is dispatched
      Then the staged score in Redis is the staging time, not 0
      And the rescored job is processed after the genuinely older one

  Rule: the age gauges cannot report an age that predates the queue

    # the gauges apply the ABSOLUTE backstop only, never the staging skew
    # bounds. a genuine backlog IS arbitrarily far in the past and reporting it
    # is the whole job, so "old" must stay reportable while "not a timestamp"
    # is skipped.

    @unit
    Scenario: the oldest-pending-age gauge skips a score from just after the Unix epoch
      Given a ready group scored a few seconds after the Unix epoch
      When queue metrics are collected
      Then the oldest-pending-age gauge does not report that group's age
      And the ready-set probe reads from the plausible-epoch backstop upwards

    @unit
    Scenario: the backlog gauge drops a head job score that is not a timestamp
      Given a sampled group whose head job score is 0
      When queue metrics are collected
      Then the backlog gauge does not read it as an age
      And a genuinely old head job is still reported however far past it is

    @unit
    Scenario: the unblock sentinel is not read as an age
      Given a just-unblocked group carrying the unblock sentinel score
      When queue metrics are collected
      Then the oldest-pending-age gauge reports 0
