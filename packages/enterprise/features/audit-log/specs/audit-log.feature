Feature: Enterprise audit logging
  Security-sensitive application actions are recorded through one portable
  capability without exposing request-framework or persistence types.

  @unit
  Scenario: A valid audit command is persisted
    Given an audit service with a repository
    When a caller records an action with JSON arguments and request metadata
    Then one bounded audit record is written

  @unit
  Scenario: Non-portable audit metadata is rejected
    When a caller records metadata containing a function
    Then contract validation rejects the command

  @unit
  Scenario: Legacy request context is normalised at the server edge
    Given a request carrying a user agent and trusted proxy address
    When the compatibility audit function records an action
    Then the persisted record contains the normalised request context
