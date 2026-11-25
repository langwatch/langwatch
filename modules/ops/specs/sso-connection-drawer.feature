Feature: Ops SSO connection drawer
  Operators can identify a connection and read its verification and history at a glance.

  @integration
  Scenario: The drawer identifies the connection and its domain verifier
    Given a named active connection with no issuer and a verified domain
    When an operator opens its drawer
    Then the header names the connection and organization with protocol and state badges
    And the summary shows an empty issuer and a readable join policy
    And the domain names its verifier and email without exposing a user id
    And the verification time is relative with an exact-time hover

  @integration
  Scenario: History groups events by day in reverse chronological order
    Given connection events across two days in arbitrary order
    When an operator reads the history
    Then events are grouped by local calendar day, newest first
    And claimed, verified, removed, renamed, activated and policy events have distinct icons
    And relative times expose exact times on hover

  @integration
  Scenario: An unavailable verifier never exposes an internal identifier
    Given a verification whose person read failed
    When an operator opens its drawer
    Then the domain says the verifier is unavailable without exposing a user id

  @integration
  Scenario: A failed history read is distinct from an empty history
    Given the connection history read failed
    When an operator opens its drawer
    Then the history reports that it could not be loaded
    And it does not claim that nothing happened

  @integration
  Scenario: The back office imports a replacement for a carried-over connection
    Given a carried-over connection with no replacement registered
    When an operator opens its drawer
    Then the migration inventory draws the import sso lends, for that organization and connection
    # Main embedded RegisterConnection mode="operator" here; ops draws sso's lend instead (§10.1).

  @integration
  Scenario: An operator's import starts the guarded migration from the back office
    Given the operator picks a provider and fills in the customer's supplied configuration
    When they press Import replacement
    Then the back office's startLegacyMigration runs for that connection, not the customer's
    And no service-provider addresses are shown, and the operator is told the current sign-in keeps working
