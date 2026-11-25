Feature: Haven simulator data persists per slug
  Restarting a development stack preserves the setup needed to keep testing
  identity flows and the emails it has already received.

  @unit @regression
  Scenario: Force restarting a stack preserves mail and IdP data for its slug
    Given a stack with received mail and a user created in its IdP directory
    When the developer replaces the stack with haven up -f
    Then the new mail process can read the received messages
    And the new IdP process can find the created user

  @unit
  Scenario: Different slugs keep separate mailboxes and IdP directories
    Given a stack with received mail and a user created in its IdP directory
    When another slug starts its own stack
    Then it has its own inbox and seeded IdP directory
    And neither contains the first stack's additions

  @unit @regression
  Scenario: IdP setup and directory changes survive a simulator restart
    Given registered applications, edited users and groups, and a provisioning target
    And configured DNS and HTTP verification records
    When the simulator restarts using the same data directory
    Then its directory, applications, credentials and verification records are restored
    And its signing keys and certificates remain unchanged
    And a registered application can still complete a login

  @unit
  Scenario: Deleted IdP state stays deleted after restarting
    Given an application, user and domain proof removed from the simulator
    When the simulator restarts
    Then the removed records are still absent
    And an explicit directory reset persists the seeded users again

  @unit
  Scenario: Temporarily reducing the IdP tenant range preserves hidden tenants
    Given a configured tenant outside a temporarily reduced tenant range
    When the developer expands the range again
    Then that tenant retains its applications and signing certificate
    And new tenants receive their initial seeded directory

  @unit
  Scenario: Unreadable IdP state is refused without reseeding over it
    Given an invalid saved IdP state file
    When the simulator starts
    Then startup fails and the saved file remains untouched

  @unit
  Scenario: An IdP change is not acknowledged when it cannot be saved
    Given the simulator's state directory becomes unavailable
    When an application registration is submitted
    Then the request reports a persistence failure
    And the last saved state remains readable
