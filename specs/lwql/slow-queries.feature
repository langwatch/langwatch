Feature: A slow LangWatchQL query gets a minute, spills to disk, and says it is slow
  Stock widgets on a project with about 2M traces a month ran past 10 s or 1 GB. The owner raised
  the time cap to 60 s (2026-11-11), the settings profile spills a big GROUP BY, sort or join to
  disk instead of failing at the memory cap, and a widget says when its query is slow or ran out
  of time.

  @unit
  Scenario: A LangWatchQL query may run for up to 60 seconds
    Given the shipped LangWatchQL limits
    Then the settings profile pins max_execution_time at 60 seconds
    And the client waits 5 seconds longer than that before it gives up

  @unit
  Scenario: The LangWatchQL profile spills a big GROUP BY, sort or join to disk
    Given the LangWatchQL settings profile
    Then it pins the GROUP BY and sort spill thresholds at half the memory cap
    And it pins a grace hash join with its in-memory budget

  @integration
  Scenario: A widget whose query runs past 5 seconds says it is a slow query
    Given a widget whose query has not answered for 5 seconds
    Then its loading skeleton says "Slow query, still running…"

  @unit
  Scenario: A widget whose query runs out of time says it took longer than 60 seconds
    Given a widget whose query fails with "query_timeout"
    Then the card says "This query took longer than 60 s, the most a widget may take."
    And a built-in widget adds that this is not a problem with the data
