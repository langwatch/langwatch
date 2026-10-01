Feature: Platform operators are seeded once, recovered by a task and managed on a page

  As the people who run a LangWatch installation
  We want the first platform operators chosen once, a way back in, and a page to manage them
  So that upgrading never locks the installation out and nobody makes themselves an operator

  # ARCHITECTURE.md, "Platform operators are a grant" and "Operator bootstrap". ops owns the seed,
  # the recovery task and the Operators page; authz owns the grant and its rules (no self-grant,
  # the last holder stays). The seed is the ops_platform_operator_seed process: its state is the
  # durable marker, set by the seed's own recorded decision: never while the seed waits, and
  # never again after, whatever happens to the holders. Only a recorded decision is granted.

  # ============================================================================
  # The one-time seed
  # ============================================================================

  @unit @operator-seed
  Scenario: A fresh install waits for its first user before seeding
    Given the installation has no user yet
    When the seed process wakes
    Then nobody is granted and the marker stays unset
    And the next wake asks again
    When the first user exists and the seed process wakes
    Then the seed decides and records its decision

  @unit @operator-seed
  Scenario: Users with no organization yet wait, and nothing latches
    Given ADMIN_EMAILS is empty
    And users exist but no organization does yet
    When the seed runs
    Then nobody is granted and nothing is recorded
    When the first organization exists and the seed runs
    Then the seed decides and records its decision

  @unit @operator-seed
  Scenario: The seed runs once behind its marker
    Given the seed has recorded its decision
    When the seed process wakes again
    Then it asks for nothing

  @unit @operator-seed
  Scenario: Deactivating every holder never re-runs the seed
    Given the seed process already set its marker
    And every platform operator has since been deactivated
    When it wakes
    Then it asks for nothing

  @unit @operator-seed
  Scenario: A seed whose decision never recorded grants nobody
    Given the seed decided to grant a user
    And recording that decision fails on every attempt
    And every platform operator has since been deactivated
    When the seed runs again
    Then nobody is granted: the seed grants only from its recorded decision
    And once a decision is recorded its users are granted once, and a second record grants nothing

  @unit @operator-seed
  Scenario: A still-set ADMIN_EMAILS seeds its verified users once
    Given no platform operator holds the grant
    And ADMIN_EMAILS names a verified active user and an unverified one
    When the seed runs
    Then only the verified user is granted, by the system, with source migration

  @unit @operator-seed
  Scenario: A set ADMIN_EMAILS waits for a named verified user and never falls back
    Given ADMIN_EMAILS names only an unverified user, or an address nobody holds
    And the installation has exactly one organization with an active administrator
    When the seed runs on two wakes
    Then nobody is granted and nothing is recorded
    And one warning says the seed waits for a user ADMIN_EMAILS names
    When the named user is verified and the seed runs
    Then only the named user is decided

  @unit @operator-seed
  Scenario: With ADMIN_EMAILS empty the oldest active admin of the only organization is seeded
    Given ADMIN_EMAILS is empty
    And the installation has exactly one organization
    When the seed runs
    Then its oldest active administrator is decided and recorded

  @unit @operator-seed
  Scenario: With several organizations nobody is seeded and the way in is logged
    Given ADMIN_EMAILS is empty
    And the installation has two organizations
    When the seed runs
    Then nobody is granted and the decision is recorded, so it latches
    And a warning names the grant-platform-operator task

  @unit @operator-seed
  Scenario: The hosted service never bootstraps
    Given the deployment is the hosted service
    When the seed runs
    Then nobody is granted, whatever ADMIN_EMAILS says

  @unit @operator-seed
  Scenario: A seed that finds operators already granted grants nobody
    Given someone already holds the grant
    When the seed runs
    Then nobody is granted

  @unit @operator-seed
  Scenario: A set ADMIN_EMAILS only warns at boot
    Given ADMIN_EMAILS is set
    When ops boots
    Then a warning says it grants nothing and names the Operators page and the task

  # ============================================================================
  # The recovery task
  # ============================================================================

  @unit @operator-recovery
  Scenario: The recovery task grants the role as the system
    Given an active account holds the address
    When grant-platform-operator runs with that address
    Then the account is granted by the system

  @unit @operator-recovery
  Scenario: The recovery task refuses an address nobody active holds
    When grant-platform-operator runs with an unknown address
    Then it fails with platform_operator_user_not_found

  # ============================================================================
  # The Operators page
  # ============================================================================

  @unit @operators-page
  Scenario: An operator grants the role to another existing user
    Given a signed-in operator
    When they grant the role to another user's address
    Then authz is asked to grant it with the operator as caller and actor

  @unit @operators-page
  Scenario: The page refuses granting yourself
    Given a signed-in operator
    When they grant the role to their own address
    Then the refusal is platform_operator_self_grant

  @unit @operators-page
  Scenario: The page refuses revoking the last holder
    Given a signed-in operator who is the only holder
    When they revoke their own grant
    Then the refusal is platform_operator_last_holder

  @unit @operators-page
  Scenario: An impersonated session cannot change who operates
    Given an operator impersonating a customer
    When they grant or revoke the role
    Then the refusal is ops_impersonated_operator_refused
