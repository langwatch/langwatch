Feature: A simulation run's cost and latency are measured once, from its traces
  What a simulation run cost, and how long each participant took, lives in the
  traces it produced. Those arrive on their own path, on their own schedule, and
  sometimes after the run has already finished. Something has to decide when the
  run is worth measuring, ask for it exactly once, and record an answer that a
  later, better answer can still correct.

  Three parts do that:

    * a read-time derivation that attributes each span's cost and duration to
      the scenario role above it, so the trace fold stays O(1) per span;
    * the `runMetrics` process manager, which arms a durable settle period when
      a run reports its result and asks for the measurement when it elapses;
    * `ComputeRunMetricsCommand`, which reads the run's own stored trace list,
      measures every trace at once, and emits a single run-level event.

  The values are carried on the event rather than joined at read time on
  purpose: spans and trace summaries are retained under the `traces` category
  while simulation runs are retained under `scenarios`, and the two are
  configured independently. A read-time join would blank a still-visible run's
  cost the moment its spans aged out.

  # PROVENANCE — this file replaces langwatch/specs/scenarios/simulation-run-metrics.feature,
  # which lived under a directory the parity checker never scanned, so every tag
  # in it bound nothing. It also described a substrate that no longer exists: a
  # "trace-side reactor" publishing metrics by ECST and a "simulation-side
  # reactor" pulling per trace on RunFinished. Reactors were retired; the
  # per-trace `metrics_computed` event was retired with them, along with the
  # unbounded traceId -> metrics accumulator its fold needed. The scenarios below
  # are written against what actually runs.

  # ---------------------------------------------------------------------------
  # Attributing cost and latency to a scenario role
  #
  # A role is an attribute on one span; the LLM calls that cost money hang
  # beneath it. Attribution therefore walks up, not down.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A costed span is charged to the role above it
    Given an agent span carrying a scenario role
    And a costed LLM span beneath it
    When the trace's role metrics are derived
    Then the LLM call's cost is attributed to that role

  @unit
  Scenario: A role reaches every span beneath it, however deep
    Given a role-bearing span with costed spans nested several levels below
    When the trace's role metrics are derived
    Then each descendant's cost is attributed to that role

  @unit
  Scenario: Two roles in one trace are charged separately
    Given a trace with costed spans under two different roles
    When the trace's role metrics are derived
    Then each span's cost lands under its nearest role ancestor

  @unit
  Scenario: A trace with no roles produces no role metrics
    Given a trace whose spans carry no scenario role
    When the trace's role metrics are derived
    Then no role cost and no role latency are reported

  @unit
  Scenario: A span with no reachable parent is left unattributed
    Given a span whose parent is absent from the trace
    When the trace's role metrics are derived
    Then it is charged to no role
    And the walk stops rather than searching further

  @unit
  Scenario: A cycle in the parent links terminates instead of hanging
    Given spans whose parent links form a cycle
    When the trace's role metrics are derived
    Then the derivation terminates

  @unit
  Scenario: Role metrics do not depend on the order spans arrived in
    Given the same spans presented in a different order
    When the trace's role metrics are derived
    Then the result is identical

  @unit
  Scenario: A role's latency is taken from the role span itself
    Given role-bearing spans with durations
    When the trace's role metrics are derived
    Then each role's latency is the sum of its own spans' durations
    And the durations of the spans beneath it are not added again

  @integration
  Scenario: A stored trace's nested LLM cost reaches its agent role end to end
    Given spans stored for a trace, with costed LLM calls under a role-bearing agent span
    When the trace's role metrics are derived from storage
    Then the agent role carries the cost of the LLM calls beneath it

  # ---------------------------------------------------------------------------
  # Deciding when to measure
  #
  # The settle period has to survive the worker that armed it. A queue delay
  # lives inside one job, so a worker lost while holding it took the run's only
  # measurement with it. The deadline is a column on the process instance, and
  # the wake worker finds it again after a restart.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A run that reports its result arms a settle period that outlives its worker
    Given a simulation run that has just finished
    When its terminal event is folded
    Then a wake deadline one settle period ahead is recorded on the run

  @unit
  Scenario: Nothing is measured while the settle period is still standing
    Given a simulation run that has just finished
    When its terminal event is folded
    Then no measurement is asked for yet

  @unit
  Scenario: A terminal event that omits the run id is still addressable
    Given a terminal event whose payload carries no run id
    When it is folded
    Then the run id is taken from the process key instead

  @unit
  Scenario: A terminal event delivered late still gets its full settle period
    Given a terminal event delivered an hour after it occurred
    When it is folded
    Then the deadline is set a settle period from now, not from when it occurred

  @unit
  Scenario: A repeated terminal event does not push the deadline out
    Given a run with a settle period already standing
    When a second terminal event for the same run arrives
    Then the standing deadline is left where it is

  @unit
  Scenario: A terminal event arriving after the measurement was asked for arms nothing
    Given a run whose measurement has already been asked for
    When another terminal event for it arrives
    Then no new deadline is armed

  @unit
  Scenario: The settle period elapsing asks for the run's metrics
    Given a run whose settle period has elapsed
    When the wake fires
    Then the run's measurement is asked for, keyed by the run

  @unit
  Scenario: A fired wake consumes its deadline rather than leaving it standing
    Given a run whose settle period has elapsed
    When the wake fires
    Then the deadline it fired for is consumed rather than left standing
    And once the re-measure ladder is spent, no further wake is scheduled at all

  @unit
  Scenario: The run records that its measurement was asked for
    Given a run whose settle period has elapsed
    When the wake fires
    Then the run is marked as having asked for its measurement

  @unit
  Scenario: Nothing upstream has to accumulate the run's trace ids
    Given a run whose settle period has elapsed
    When the wake fires
    Then the request carries no trace ids
    And the traces to measure are read from the run's own stored state instead

  @unit
  Scenario: Two wakes racing each other ask for the measurement once
    Given a run whose settle period has elapsed
    When two wakes fire for it
    Then both requests collapse onto the same key

  @unit
  Scenario: A run that cannot be addressed stops being retried
    Given a run instance with no usable id
    When the wake fires
    Then nothing is asked for
    And no further wake is scheduled, so the wake worker stops re-finding it

  @unit
  Scenario: Deleting a run drops its pending measurement
    Given a run with a settle period standing
    When the run is deleted
    Then the pending measurement is dropped
    And no further wake is scheduled

  @unit
  Scenario: A deleted run is not revived by a later terminal event
    Given a deleted run
    When a terminal event for it arrives
    Then no deadline is armed

  @unit
  Scenario: A wake on a deleted run asks for nothing
    Given a deleted run whose deadline had already been armed
    When the wake fires
    Then nothing is asked for

  # ---------------------------------------------------------------------------
  # What the process manager is allowed to keep
  #
  # A run's terminal event carries the whole conversation and the judge's
  # reasoning. Process state and outbox rows are a second copy of whatever they
  # are handed, so they are handed one field.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The conversation and the judge's reasoning never reach process state
    Given a terminal event carrying the run's messages and the judge's reasoning
    When it is narrowed for the process
    Then only the run id is kept

  @unit
  Scenario: An unreadable terminal event does not wedge the run
    Given a terminal event whose run id is missing or of the wrong type
    When it is narrowed for the process
    Then a null id is produced rather than an error
    And the run keeps advancing instead of retrying the same event forever

  # ---------------------------------------------------------------------------
  # Measuring the run
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A measured run records one event for the whole run
    Given a finished run with one trace that has a cost and role-bearing spans
    When the run is measured
    Then a single run-level metrics event is recorded
    And it carries the run's total cost and its per-role cost and latency

  @unit
  Scenario: Each trace is measured within its own partition
    Given a finished run with a trace whose summary has been folded
    When the run is measured
    Then the derivation is given the trace's own time and fold watermark
    And the read is confined to that partition rather than scanning every one

  @unit
  Scenario: A run with latency but nothing priced records the latency and no cost
    Given a finished run whose trace reports role latency but no cost
    When the run is measured
    Then the role latency is recorded
    And the total cost is reported as absent rather than as zero

  @unit
  Scenario: Role metrics are derived even when the trace summary has not landed
    Given a finished run whose trace has spans stored but no summary yet
    When the run is measured
    Then the role metrics are still derived from the stored spans

  @unit
  Scenario: A run's cost is the sum across all of its traces
    Given a finished run with several traces, each contributing cost and latency
    When the run is measured
    Then the total cost is the sum across them
    And each role keeps one value per trace

  @unit
  Scenario: Aggregated role values follow the run's trace order, not the order the reads finished
    Given a finished run with several traces whose reads complete out of order
    When the run is measured
    Then the recorded values are ordered by the run's own trace list

  @unit
  Scenario: A trace that arrived after the run finished is still measured
    Given a finished run whose stored state gained a trace after it finished
    When the run is measured
    Then that trace is measured too

  @unit
  Scenario: A run that cannot be measured keeps the metrics it already shows
    Given a finished run whose traces report no cost and carry no roles
    When the run is measured
    Then no event is recorded
    And the run's stored metrics are left as they are rather than blanked

  @unit
  Scenario: A run with no traces is not measured
    Given a finished run that produced no traces
    When the run is measured
    Then no trace is read
    And no event is recorded

  @unit
  Scenario: A run with nothing folded for it is not measured
    Given a run with no stored state
    When the run is measured
    Then no event is recorded

  @unit
  Scenario: A run deleted during the settle period is never measured
    Given a run deleted after its measurement was asked for but before it ran
    When the run is measured
    Then no trace is read
    And no event is recorded

  @unit
  Scenario: A failed trace read retries rather than recording a partial run
    Given a finished run whose trace read fails
    When the run is measured
    Then the failure propagates so the queue retries
    And no partial measurement is recorded

  # ---------------------------------------------------------------------------
  # Measuring twice
  #
  # Idempotency keyed on the values, not on the run alone. Keyed on the run, the
  # event store's keep-the-first rule froze whatever the earliest attempt saw, so
  # a run measured while cost enrichment was still in flight showed zero forever.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Measuring the same run twice with the same answer records it once
    Given a run measured twice, both times producing the same values
    Then the second measurement collapses onto the first

  @unit
  Scenario: A corrected measurement replaces the earlier one
    Given a run measured once before its costs had landed
    When it is measured again and the values are different
    Then the correction is recorded rather than discarded

  @unit
  Scenario: The same answer with roles in a different order is the same answer
    Given two measurements with identical values but different role key order
    Then they are treated as the same measurement

  # ---------------------------------------------------------------------------
  # When the cost lands after the run settles
  #
  # A run's cost is not the run's to report. It is enriched onto the traces the
  # agent under test produced, which are exported on the SDK's own schedule and
  # folded behind whatever the ingest path is currently carrying. The run's own
  # terminal event is not waiting for any of that, so "the run finished" and
  # "the run's cost is knowable" are two different instants, and the gap between
  # them has no fixed width.
  #
  # The settle period bets on that gap being short. When the bet loses — the
  # measurement runs, every trace is read, and not one of them reports a cost
  # yet — one measurement per run means the run shows no cost for the rest of
  # its life, because nothing asks a second time.
  #
  # So the empty answer re-arms. It is the only signal that separates "this run
  # was measured too early" from "this run has been measured"; re-arming on it
  # targets the runs that lost the bet and leaves every other run untouched. The
  # ladder of re-measures is short and finite, so a run whose traces will never
  # report a cost stops asking rather than re-asking forever.
  #
  # A re-measure is safe to ask for at all because the measurement's idempotency
  # key is fingerprinted on the values it computed: the same answer collapses at
  # the event store, and a better answer is a different event and lands.
  #
  # MERGED from specs/simulations/run-metrics-late-cost.feature, whose own header
  # asked for exactly this fold. Scenario titles are unchanged, so every binding
  # written against that file still resolves.

  # --- Asking again ---

  @unit
  Scenario: A measurement that found no cost is asked for again
    Given a finished run whose traces report no cost when the settle period elapses
    When the measurement comes back with nothing to record
    Then a further measurement is scheduled for the run

  @unit
  Scenario: A cost that lands after the settle period is still recorded
    Given a run measured once before its traces reported a cost
    When the cost lands and the run is measured again
    Then the run's cost is recorded from the later measurement

  @unit
  Scenario: Each re-measure is asked for under its own key
    Given a run being measured a second time
    When the request is made
    Then it carries a different key from the first request
    And the outbox therefore dispatches it rather than suppressing it as a duplicate

  # --- Stopping ---

  @unit
  Scenario: A recorded measurement stops the re-measures
    Given a run with a re-measure scheduled
    When its metrics are recorded
    Then no further measurement is scheduled

  @unit
  Scenario: A run whose traces never report a cost stops asking
    Given a run whose every measurement comes back with nothing to record
    When the last re-measure has been asked for
    Then no further measurement is scheduled
    And the run has been measured no more times than the ladder allows

  @unit
  Scenario: Deleting a run stops its re-measures too
    Given a run with a re-measure scheduled
    When the run is deleted
    Then no further measurement is asked for
