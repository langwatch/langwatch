Feature: Windowed reads fall back on a leash, and the fallback is measured

  Many reads answer from a narrow slice of recent time, so they scope the read
  to that slice and let the storage skip the cold history behind it. A slice can
  miss — a row that straddles the edge, a clock a little off, an aggregate that
  went quiet — so a read may widen to a larger, or unlimited, look-back to still
  find its answer. Widening to an unlimited scan is the expensive move: it walks
  cold history that the narrow read was built to avoid, and one such scan
  triggered by a routine miss is cheap while a flood of them at once is the load
  that stalls every other reader. So widening is a deliberate, declared choice,
  and — this is the point — it is never silent: every windowed read is counted,
  and a widen is counted as a widen. (ADR-068.)

  Background:
    Given a read scoped to a recent-time window with a declared fallback

  @unit
  Scenario: a windowed read that finds its answer stays in the window
    Given the answer lies inside the scoped window
    When the read runs
    Then it answers from the window without widening
    And it is recorded as having answered inside the window

  @unit
  Scenario: a windowed read that misses widens, and the widening is recorded
    Given the caller allows the read to widen within a bounded look-back when the window misses
    And the answer lies outside the scoped window but inside the look-back
    When the read runs
    Then the window misses and the read widens to find the answer
    And the widened read stays inside its bounded look-back, it does not scan without limit
    And the widening is recorded as an outcome distinct from an in-window answer

  @unit
  Scenario: a widen that still finds nothing is recorded as an empty widen
    Given the caller allows the read to widen within a bounded look-back when the window misses
    And there is no answer inside or outside the window
    When the read runs
    Then the read widens within its look-back and still finds nothing
    And the empty widen is recorded as its own outcome, not a silent miss

  @unit
  Scenario: a read that fails is recorded as a failure, not lost
    Given a read whose attempt fails outright
    When the read runs
    Then the failure is surfaced to the caller
    And the failure is recorded as its own outcome, so failed reads are never invisible

  @unit
  Scenario: a caller that forbids widening stays bounded on a miss
    Given the caller declares the scoped window authoritative
    And the answer lies outside the scoped window
    When the read runs
    Then the read does not widen beyond its window
    And it returns the in-window result without a second, wider scan

  @unit
  Scenario: an unlimited widen is recorded as unlimited, not as a bounded one
    Given the caller allows the read to widen to an unlimited scan
    And the answer lies outside every bounded window
    When the read runs and widens to the unlimited scan
    Then the unlimited widen is recorded as its own outcome
    And it is distinguishable from a widen that stayed within a bounded look-back

  @unit
  Scenario: a read with no time hint is recorded as unwindowed
    Given a read issued without a recent-time hint
    When the read runs
    Then it is recorded as having run without a window
    And the record names the table it ran against, like every other windowed read

  # ADR-068, point 3 — the rate-limited fallback ships as a separate change,
  # after the outcome counts above establish a per-table baseline for its limit.
  @unimplemented @planned
  # Not yet implemented as of 2026-07-24 — this change measures the fallback so
  # its rate can be chosen from observed load; the token-bucket limiter and the
  # required / best-effort fallback declaration are the sequenced follow-up.
  Scenario: a flood of misses cannot multiply into concurrent unlimited scans
    Given a burst of windowed reads that all miss their window at once
    And their fallbacks would each widen to an unlimited scan
    When the reads run together under load
    Then the number of concurrent unlimited scans is held under a bound
    And best-effort widens are shed before load-bearing ones
