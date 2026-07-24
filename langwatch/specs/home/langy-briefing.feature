Feature: Langy's home briefing reads real problem-case signals
  As a returning user landing on the project home
  I want Langy's briefing to surface the traces and runs that actually need a look
  So that I start from real receipts, not vanity metrics or invented numbers

  # ---------------------------------------------------------------------------
  # The briefing derives a "Needs a look" list from the project's REAL analytics
  # and scenario runs. Every receipt links to the filtered view that proves it.
  # Where a signal has no real source, the receipt is OMITTED — never faked
  # (honest degradation).
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Errored traces surface as an error receipt linking to the filtered list
    Given the project has 3 traces that returned an error in the last 30 days
    When the briefing receipts are derived
    Then a receipt reads "3 traces erroring"
    And its severity is error
    And it links to the trace list filtered to errored traces

  @unit
  Scenario: A single errored trace uses singular wording
    Given the project has 1 trace that returned an error in the last 30 days
    When the briefing receipts are derived
    Then a receipt reads "1 trace erroring"

  @unit
  Scenario: No errors on an active project reads as crash-free
    Given the project has traces but none returned an error in the last 30 days
    When the briefing receipts are derived
    Then a receipt notes there were no errored traces in the last 30 days
    And its severity is steady

  @unit
  Scenario: The slowest trace is surfaced with its multiple over the median
    Given the median trace latency is 1000ms
    And the slowest trace took 8200ms
    When the briefing receipts are derived
    Then a receipt names the slowest trace with value "8.2s"
    And it reads as an outlier over the median
    And it links to the trace list sorted by slowest first

  @unit
  Scenario: A slowest trace close to the median is not flagged as an outlier
    Given the median trace latency is 1000ms
    And the slowest trace took 1200ms
    When the briefing receipts are derived
    Then the slowest-trace receipt severity is steady

  @unit
  Scenario: The most expensive run is surfaced when cost is visible
    Given the user can view cost
    And the average run costs $0.02
    And the most expensive run costs $0.42
    When the briefing receipts are derived
    Then a receipt names the most expensive run with value "$0.42"
    And it links to the trace list sorted by most expensive first

  @unit
  Scenario: Cost receipts are omitted without cost permission
    Given the user cannot view cost
    When the briefing receipts are derived
    Then no receipt mentions run cost

  @unit
  Scenario: A quiet project shows no receipts
    Given the project has no traces in the last 30 days
    When the briefing receipts are derived
    Then no receipts are shown

  @unit
  Scenario: Scenario suite runs drive the scenario section, not definitions
    Given the project has scenario set summaries with real pass and fail counts
    When the briefing is derived
    Then the scenario bars reflect the actual pass and fail counts per set
    And a set with failures is coloured as failing

  # ---------------------------------------------------------------------------
  # Home layout: the side space becomes a calm rail; refetches never wipe data.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The home briefing uses the side space for a rail
    Given the briefing has loaded
    When the home briefing section renders on a wide viewport
    Then a side rail of quick links and jump-back-in items sits beside the briefing
    And on a narrow viewport the rail collapses below the briefing

  @integration
  Scenario: Refetching does not wipe the overview card
    Given the overview card is showing cached data
    When the underlying queries refetch in the background
    Then the previous data stays on screen
    And only a subtle refreshing hint is shown, not a full skeleton swap
