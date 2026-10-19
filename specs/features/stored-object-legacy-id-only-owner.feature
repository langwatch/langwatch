Feature: A stored object named by its id alone resolves its owning project

  Media links written before stored objects carried their project carry the
  object id and nothing else. Serving one means answering, from the id, which
  project owns it — a read that spans every tenant by construction, because
  there is no tenant in the request to route on.

  The API process answers it over the ClickHouse endpoints it opened: the
  shared one and each private route, once per endpoint. A deployment that
  opened none has no directory to ask, and says so by resolving to nothing
  rather than by naming a project it guessed.

  @unit
  Scenario: A legacy id-only stored-object URL resolves its owning project
    Given the API process opened a shared and a private ClickHouse endpoint
    When a delivery names a stored object by its id alone
    Then every endpoint is asked which project owns that object
    And the project that holds the row is the answer

  @unit
  Scenario: An id-only URL on a deployment with no owner directory resolves to nothing
    Given the API process opened no ClickHouse endpoint
    When a delivery names a stored object by its id alone
    Then the delivery resolves to no project
    And the process says it composed no owner directory
