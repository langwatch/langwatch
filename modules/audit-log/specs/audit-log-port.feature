Feature: The audit log port
  Every writer and reader of the audit trail reaches it through one portable
  capability. The implementation is core and every process installs it.

  @unit
  Scenario: An installation with no Enterprise module still records management writes
    Given a process composed from the audit log module alone
    When a management write is recorded
    Then the write is accepted and the entity's history holds it

  @unit
  Scenario: Operator actions reach the audit log through its port
    Given an operator drains a queue, wakes a process and runs a schedule
    When each control completes
    Then each act is recorded on the audit log with its target and metadata
    And no operator surface writes the audit table itself

  @unit
  Scenario: Non-portable audit metadata is rejected
    When a caller records metadata containing a function
    Then contract validation rejects the command
