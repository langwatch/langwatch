Feature: One registrant per identity pipeline, per process

  Identity publishes four pipelines - identity, join-requests, sso-connections
  and scim-sync. A process that only stages commands on them registers the
  producer-only definitions while it composes Identity. A process that also
  DRAINS them registers the complete Postgres definitions in its install phase
  instead, and composes Identity without registering anything, because one
  runtime holds one registration per pipeline name and the second one is
  refused by name.

  @unit
  Scenario: The producing process registers the four pipelines it stages commands on
    Given a process in Identity's producer role
    When it composes Identity
    Then each of the four identity pipelines is registered exactly once

  @unit
  Scenario: The draining process registers no second pipeline
    Given a process that drains the identity pipelines
    When it composes Identity before its install phase
    Then it registers no pipeline at all

  @unit
  Scenario: A command asked for before the install phase names the missing registration
    Given a process that drains the identity pipelines
    And nothing has registered the identity pipeline yet
    When a caller asks for one of identity's verbs
    Then the refusal names the pipeline it could not find

  @unit
  Scenario: Identity's commands reach the registration the process made
    Given a process that drains the identity pipelines
    And its install phase has registered the complete definitions
    When a caller stages a verb on two different identity pipelines
    Then each command is sent through the process's own registration

  @unit
  Scenario: A verb the module does not publish stays uncommandable
    Given a process that drains the identity pipelines
    When a caller asks for a command outside identity's verb lists
    Then the answer is that the command is not commandable on this process
