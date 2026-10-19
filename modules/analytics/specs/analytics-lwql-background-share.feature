Feature: A background LangWatchQL caller uses only a share of the project's window

  Every LangWatchQL execution counts against the project's one window, at the bound its plan
  answers. A check with nobody waiting, such as the daily board health check, may use only a
  third of that window, so people reading boards in the same minute keep the rest.

  @unit
  Scenario: A background execution is refused once the window holds a third of the bound
    Given a project whose plan allows a bound of queries a minute
    When background executions run in one window
    Then a third of the bound is admitted and the next one is refused as rate limited
    And executions from people already in that window count toward the third

  @unit
  Scenario: A foreground execution still has the whole window
    Given the project's window holds a third of the bound from background executions
    When a person runs a query
    Then it is admitted, up to the full bound

  @unit
  Scenario: A refused background execution is counted apart from people's
    Given a background execution and a person's execution in one window
    When each is checked against the window
    Then only the background check names its own scope, so its refusals never move people's rate-limit count
