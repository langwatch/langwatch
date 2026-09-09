Feature: The audit log port
  Every writer and reader of the audit trail reaches it through one portable
  capability, so an installation decides once what is recorded. The
  implementation is Enterprise; an installation without it answers with the
  null one under the same token.

  @unit
  Scenario: An installation without the Enterprise audit log records nothing
    Given a process that installed no Enterprise audit log
    When a management write is recorded
    Then the write is accepted and the entity's history is empty

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
