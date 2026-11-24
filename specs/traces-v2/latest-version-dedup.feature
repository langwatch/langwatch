Feature: Trace reads keep each trace's latest version without a set of every trace

  trace_summaries keeps a row per version of a trace until its parts merge. Every trace list,
  count and facet read keeps only the latest version. It did so with a set of every trace's
  latest version in the window, which grew with the window: on a window of 600,000 traces it
  needed 233 MiB, and on 3 million traces the facet batch needed 1.05 GiB. The dedup now holds
  only traces that have an older version in the window, so it stays small however many traces
  the window has or however many versions each trace has.

  @integration @regression
  Scenario: The latest-version dedup holds only traces with an older version
    Given a window of 600,000 traces where 100,000 have an older and a newer version
    When a read keeps only each trace's latest version
    Then it counts every trace once, on its newer version
    And it needs at most half the memory of a set of every latest version

  @integration @regression
  Scenario: The latest-version dedup stays small when every trace has many versions
    Given a window of 50,000 traces with 20 versions each
    When a read keeps only each trace's latest version
    Then it counts every trace once, on its newest version
    And it needs at most twice the memory of a set of every latest version

  @integration @regression
  Scenario: A version outside the dedup window never passes
    Given traces with one version inside the dedup window and a newer version after it
    When a read over a wider window keeps only each trace's latest version
    Then it returns each trace once, on the version inside the dedup window
