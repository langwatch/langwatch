Feature: Analytics v2 page on dashboard widgets over LangWatchQL

  As a LangWatch member
  I want an Analytics v2 page whose nine standard charts are dashboard widgets fed by LangWatchQL through the query API
  So that the legacy analytics pages can later be replaced by the new stack

  Analytics v2 renders nine inline widget definitions through the same
  sandboxed frame dashboards use, every query an LWQL statement bound to the
  page's period. It sits beside the legacy analytics pages, behind the
  release_analytics_v2 flag, and it needs LangWatchQL available for the project.

  @integration
  Scenario: The Analytics v2 page shows the nine charts
    Given a project with LangWatchQL enabled and the release flag on
    When a member opens /:project/analytics/v2
    Then nine chart cards are shown, titled Trace count over time, Total cost over time, Tokens over time, Latency percentiles, Satisfaction over time, Evaluation pass rate, Average traces per thread, Top models, Top topics
    And each card renders a dashboard widget rather than a legacy analytics graph

  @integration
  Scenario: Changing the period re-queries every chart
    Given the page is open for one period
    When the member picks a different period
    Then every one of the nine widgets receives the new period

  @integration
  Scenario: The Analytics v2 page is hidden until the release flag is on
    Given a project where the release_analytics_v2 flag is off
    When a member opens /:project/analytics/v2
    Then the page shows a single message that Analytics v2 is not available yet
    And no widget cards are rendered

  @integration
  Scenario: A project without LangWatchQL sees one clear message
    Given a project with the release flag on where LangWatchQL is not enabled
    When a member opens /:project/analytics/v2
    Then the page shows a single message saying LangWatchQL is not enabled for this project
    And no widget cards are rendered

  @integration
  Scenario: One failing widget does not take the other eight down
    Given one widget throws while rendering
    When the page renders
    Then that card shows a failure
    And the other eight cards still render

  @unit
  Scenario: Every chart reads its data through the LangWatchQL query API only
    Then each of the nine widget definitions is a valid dashboard widget definition
    And each of its queries is bound to the page period through the reserved period placeholders
    And none of the definitions reads from the legacy analytics router

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

  @unit
  Scenario: Widget SQL applies no duration filter, matching legacy parity
    Then no widget query filters on a positive total duration
    And the counts match what legacy analytics reports for the same period
