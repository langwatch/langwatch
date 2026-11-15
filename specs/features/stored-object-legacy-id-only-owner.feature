Feature: A stored object named by its id alone stays unresolvable

  Media links written before stored objects carried their project carry the
  object id and nothing else. Such a link stays unresolvable (ADR-202 Decided
  23): the process composes no owner directory and resolves it to no project.

  @unit
  Scenario: An id-only URL on a deployment with no owner directory resolves to nothing
    Given the API process opened no ClickHouse endpoint
    When a delivery names a stored object by its id alone
    Then the delivery resolves to no project
    And the process says it composed no owner directory
