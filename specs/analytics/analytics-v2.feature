Feature: Analytics v2 page on dashboard widgets over LangWatchQL

  As a LangWatch member
  I want an Analytics v2 page whose nine standard charts are dashboard widgets fed by LangWatchQL through the query API
  So that the legacy analytics pages can later be replaced by the new stack instead of by an unowned scripts folder

  Legacy analytics at /[project]/analytics runs on a bespoke analytics
  pipeline. The parity work for a replacement lived in the legacy parity
  scripts folder under platform/app/scripts, which no product surface owned.
  This page moves that work in-app: nine inline widget
  definitions, rendered by the same sandboxed frame dashboards use, every
  query an LWQL statement bound to the page's period. The scripts folder is
  deleted in the same change.

  Background:
    Given a project with LangWatchQL enabled

  @integration
  Scenario: The Analytics v2 page shows the nine charts
    When a member opens /[project]/analytics-v2
    Then nine chart cards are shown, titled Trace count over time, Total cost over time, Tokens over time, Latency percentiles, Satisfaction over time, Evaluation pass rate, Average traces per thread, Top models, Top topics
    And each card renders a dashboard widget rather than a legacy analytics graph

  @integration
  Scenario: Changing the period re-queries every chart
    Given the page is open for one period
    When the member picks a different period
    Then every one of the nine widgets receives the new period

  @unit
  Scenario: Top Topics groups by topic only and shows a raw id when the name is missing
    Then the Top Topics query groups by the topic id alone, not by subtopic
    And a topic whose name cannot be resolved is shown by its raw topic id, never the word "unknown"

  @unit
  Scenario: A period with no traces shows an empty state, not an error
    Given a chart's query returns zero rows
    When the widget renders
    Then it shows an empty state message
    And it does not show an error

  @e2e
  Scenario: Headline numbers match the legacy analytics for the same period
    Given traces recorded in a fixed period
    When the trace count is read through the legacy analytics pipeline and through the Analytics v2 query
    Then the two counts are equal

  @unit
  Scenario: The legacy parity scripts folder is gone and nothing references it
    Then the legacy parity scripts folder under platform/app/scripts does not exist
    And no file in the repository references the legacy parity scripts folder

  @unit
  Scenario: The starter dashboard seed still resolves every widget file
    When the starter dashboard manifest is read
    Then every listed widget file exists on disk
    And none of them lives in the deleted folder

  @integration
  Scenario: One failing widget does not take the other eight down
    Given one widget throws while rendering
    When the page renders
    Then that card shows a failure
    And the other eight cards still render

  @integration
  Scenario: A project without LangWatchQL sees one clear message
    Given a project where LangWatchQL is not enabled
    When a member opens /[project]/analytics-v2
    Then the page shows a single message saying LangWatchQL is not enabled for this project
    And no widget cards are rendered

  @integration
  Scenario: The page waits while the organization is still resolving
    Given a member opens /[project]/analytics-v2
    When the organization or the LangWatchQL flag has not resolved yet
    Then the page shows a loading spinner
    And neither the disabled message nor any widget card is rendered

  @integration
  Scenario: A failed LangWatchQL flag check offers a retry
    Given a member opens /[project]/analytics-v2
    When the LangWatchQL flag check fails
    Then the page says it could not check whether LangWatchQL is enabled for this project
    And a Try again control re-runs the flag check
    And the page never claims LangWatchQL is disabled

  @integration
  Scenario: A refused workspace read shows an error with a retry, not a spinner
    Given a member opens /[project]/analytics-v2
    When the workspace read is refused
    Then the page shows the workspace error state with a Try again control
    And neither the loading spinner, the disabled message nor any widget card is rendered

  @unit
  Scenario: Reverting the change needs no data migration
    Given the change is reverted
    Then the scripts folder is restored
    And the route is removed
    And no stored data changes

  @unit
  Scenario: Every chart reads its data through the LangWatchQL query API only
    Then each of the nine widget definitions is a valid dashboard widget definition
    And each of its queries is bound to the page period through the reserved period placeholders
    And none of the definitions reads from the legacy analytics router

  # --- AC Coverage Map ---
  # AC1  (nine standard charts as dashboard widgets)        -> The Analytics v2 page shows the nine charts
  # AC2  (period selector re-queries every widget)           -> Changing the period re-queries every chart
  # AC3  (Top Topics: group by topic, raw id fallback)       -> Top Topics groups by topic only and shows a raw id when the name is missing
  # AC4  (empty state, not an error, on zero rows)           -> A period with no traces shows an empty state, not an error
  # AC5  (parity with legacy analytics pipeline)             -> Headline numbers match the legacy analytics for the same period
  # AC6  (legacy parity scripts folder deleted)               -> The legacy parity scripts folder is gone and nothing references it
  # AC7  (starter dashboard seed still resolves)              -> The starter dashboard seed still resolves every widget file
  # AC8  (one widget failure isolated from the rest)          -> One failing widget does not take the other eight down
  # AC9  (LangWatchQL-disabled project message)               -> A project without LangWatchQL sees one clear message
  # AC9  (supporting)                                         -> The page waits while the organization is still resolving
  # AC9  (supporting)                                         -> A failed LangWatchQL flag check offers a retry
  # AC9  (supporting)                                         -> A refused workspace read shows an error with a retry, not a spinner
  # AC10 (rollback needs no data migration)                   -> Reverting the change needs no data migration
  # AC11 (query API only, no legacy analytics router reads)   -> Every chart reads its data through the LangWatchQL query API only
