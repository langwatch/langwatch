@unit
Feature: Homepage attention briefing
  As a returning project member
  I want the homepage briefing to prioritize evidence-backed changes
  So that I can act on what needs attention instead of scanning vanity totals

  Background:
    Given I am viewing an activated project's briefing home

  Scenario: A new error shape leads the attention inbox
    Given the current error-message facet contains a shape absent from the prior 30 days
    And the prior error-message facet result is exhaustive
    When the briefing builds its attention inbox
    Then the new error shape appears before repeated signals and latency changes
    And its action opens the Trace Explorer with that exact error-message query
    And I can attach the same query to Langy or ask Langy to investigate it

  Scenario: An incomplete prior facet does not prove an error shape is new
    Given the current error-message facet contains a shape absent from the prior top-N results
    But the prior result has additional distinct values outside that page
    When the briefing builds its attention inbox
    Then the shape is surfaced with its current evidence
    But it is not labelled as new

  Scenario: A materially regressed error shape compares periods
    Given an error shape occurs at least 50 percent more often than in the prior window
    And it has increased by at least 2 traces
    When the briefing builds its attention inbox
    Then the row is labelled "Error shape regressed"
    And the current and prior counts are shown

  Scenario: Shared evidence is not presented as a proven cause
    Given multiple errored traces share a trace name
    When the briefing surfaces that shared signal
    Then it says the signal is a correlation and not a confirmed cause
    And the supporting action filters to errors with that trace name

  Scenario: Latency needs a meaningful comparable regression
    Given current p50 latency is at least 25 percent and 250 milliseconds above the prior window
    When the briefing builds its attention inbox
    Then it shows a latency regression with a slow-trace search action
    But a one-off maximum does not become an insight card

  Scenario: Missing shape evidence degrades honestly
    Given errored traces are known to exist
    But error-message facets cannot be compared
    When the briefing builds its attention inbox
    Then it asks the reader to triage the matching errors
    And it does not claim a shared shape or root cause

  Scenario: Raw totals stay in the quiet overview
    Given trace, token, user, and cost totals are available
    When the briefing renders
    Then those totals do not become attention-inbox rows
    And only changed errors, repeated evidence, or meaningful latency regressions lead
