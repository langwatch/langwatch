Feature: The organization tRPC outputs declare exactly what they send
  The member list and the audit log answer with the keys their contract
  declares and main served, so output validation has nothing to log.

  @unit
  Scenario: The member list carries the user's declared columns and no others
    Given an organization member whose stored user has columns the wire does not declare
    When the members are read for the administrators' list
    Then each user carries only the declared columns
    And the stored passkey signup claim hash is never among them

  @unit
  Scenario: An audit log entry declares the before and after states main served
    Given an audit log entry carrying a gateway before and after state
    When the entry is checked against the audit log page contract
    Then the entry is accepted with its before and after states
