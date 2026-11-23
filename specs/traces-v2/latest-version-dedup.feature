Feature: Trace reads keep each trace's latest version without a set of every trace

  trace_summaries keeps a row per version of a trace until its parts merge. Every trace list,
  count and facet read keeps only the latest version. It did so with a set of every trace's
  latest version in the window, which grew with the window: on a window of 600,000 traces it
  needed 233 MiB, and on 3 million traces the facet batch needed 1.05 GiB. The dedup now holds
  only the versions a newer one replaced, which stays small once parts merge.

  @integration @regression
  Scenario: The latest-version dedup holds only superseded versions
    Given a window of 600,000 traces where 100,000 have an older and a newer version
    When a read keeps only each trace's latest version
    Then it counts every trace once, on its newer version
    And it stays under a 140 MB memory cap
