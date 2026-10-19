Feature: A member triggers topic clustering by hand
  Topic owns the manual trigger (`topics.triggerTopicClustering`, `project:update`).
  It refuses while a run is in flight, records the request attributed to the member,
  and reports a request that did not land. Moved from project (peer-cycle cut P).

  @unit
  Scenario: A manual clustering request while a run is in flight says so
    Given a project whose clustering run is in flight
    When a member asks for a manual clustering run
    Then the member is told a run is already going
    And no new clustering request is recorded

  @unit
  Scenario: A manual clustering request is attributed to the member who asked
    Given a project with no clustering run in flight
    When a member asks for a manual clustering run
    Then a manual clustering request is recorded with the member's id
    And the member is told the run started

  @unit
  Scenario: A deployment without a clustering scheduler refuses by name
    Given a process composes the topic surface with no topic-clustering scheduler
    When a caller asks for a manual clustering run
    Then the caller is told this deployment does not offer that service
    And the refusal reaches the caller by name rather than as an unknown failure

  @unit
  Scenario: A clustering run that fails inside the platform degrades to an unknown failure
    Given a process composes the topic surface with a clustering scheduler
    When the scheduler fails for a reason no caller can act on
    Then the process records the failure
    And the caller is told only that the request failed, with a trace id to quote

  @unit
  Scenario: A clustering request whose scheduler cannot be reached is reported, not raised
    Given a deployment whose clustering scheduler cannot be reached
    When a member asks topics.triggerTopicClustering for a manual run
    Then the failure is reported for the project it happened on
    And the member is answered with an unknown failure rather than a named one
