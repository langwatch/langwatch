Feature: An unwritable dataset storage root is a named failure, not an unknown 500
  As an agent or a person adding records to a dataset
  I want the platform to name the failure and who has to fix it
  So that I do not read a bare 500 and guess

  # A self-hosted stack with no object storage configured falls back to a local
  # filesystem root. When that root is not writable every record write fails.
  # We know the cause and we know the fix, so per ADR-045 this is a handled
  # error with a stable code, not an unattributed 500.
  #
  # The environment variable names and the on-disk path are operator detail:
  # they belong in the server log line and in the remediation tips, never in
  # the message that ships in the response body.

  @unit
  Scenario: The refusal carries the storage_not_writable code
    Given a dataset storage root that the process cannot write to
    When records are written to it
    Then the failure is a handled error with code "storage_not_writable"
    And the failure is attributed to the platform, not to the customer

  @unit
  Scenario: The message names no environment variable and no path
    Given a dataset storage root that the process cannot write to
    When records are written to it
    Then the message that ships to the caller names no environment variable
    And the message names no filesystem path

  @unit
  Scenario: The remediation names the two ways an operator fixes it
    Given the storage_not_writable code
    When the remediation for it is read
    Then one tip names the object storage bucket setting
    And one tip names the local storage path setting

  @unit
  Scenario: A permission failure that is not a write refusal stays unknown
    Given a dataset storage root that fails for a reason other than permissions
    When records are written to it
    Then the original failure is rethrown unchanged
    And it is not reported as a handled error

  @unit
  Scenario: The customer reads copy written for the code
    Given a handled failure with code "storage_not_writable"
    When the app explains it
    Then the copy states that saving is blocked until an administrator acts
    And the copy names no environment variable
