Feature: A fold for a deleted project completes instead of retrying
  As an operator running a LangWatch deployment
  I want events for a project deleted after they were sent to be dropped by their folds
  So that a deleted project never blocks a queue group with retries that can never succeed

  @unit
  Scenario: A fold whose project no longer exists completes as a no-op
    Given a project that was deleted after its event was stored
    When the fold reads the project's own rows and authz reports the project not found
    Then the event completes with a warning and is not retried

  @unit
  Scenario: A fold that fails for any other reason is still retried
    Given a fold whose read fails for a reason other than a deleted project
    When the queue runs the fold
    Then the failure is rethrown so the queue retries it

  @unit
  Scenario: Platform code asking for a proof on a deleted project is told the project was not found
    Given a project that does not exist
    When platform code asks authz for a read pass on it
    Then authz refuses with project_not_found, not access_not_granted
