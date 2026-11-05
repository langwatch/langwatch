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
    Given the installation has email configured
    And no platform operator holds the grant
    And ADMIN_EMAILS names a verified active user and an unverified one
    When the seed runs
    Then only the verified user is granted, by the system, with source migration

  @unit @operator-seed
  Scenario: A set ADMIN_EMAILS waits for a named verified user and never falls back
    Given the installation has email configured
    And ADMIN_EMAILS names only an unverified user, or an address nobody holds
    And the installation has exactly one organization with an active administrator
    When the seed runs on two wakes
    Then nobody is granted and nothing is recorded
    And one warning says the seed waits for a user ADMIN_EMAILS names
    When the named user is verified and the seed runs
    Then only the named user is decided

  @unit @operator-seed
  Scenario: An install with no email configured seeds the named user unverified
    Given the installation has no email configured, so no account can verify its address
    And ADMIN_EMAILS names an active user whose address was never verified
    And that user is the install's first-created account
    And the installation has exactly one organization whose administrator is somebody else
    When the seed runs
    Then the named user is decided and recorded, and the administrator is not
    And the ops:seed-platform-operators upgrade step grants the named user too
    And a deactivated named user is still skipped
    And an address nobody has signed up with still waits, since the seed never creates an account
    And a mailer that is named but misconfigured counts as email configured, so the seed waits

  @unit @operator-seed
  Scenario: With no email configured a named unverified account that signed up later waits
    Given the installation has no email configured
    And ADMIN_EMAILS names an unverified active account that is not the install's first-created account
    When the seed runs, or the ops:seed-platform-operators upgrade step runs
    Then nobody is granted and nothing is recorded, since anyone could have registered that address
    And the wait reason says the named account is not the install's first-created account
    And a verified user ADMIN_EMAILS also names is still seeded

  # A deactivated first account never hands its place to the next sign-up (Rogerio, 2026-10-19).
  @unit @operator-seed
  Scenario: With no email configured a deactivated first account seeds no later unverified sign-up
    Given the installation has no email configured
    And the install's first-created account has been deactivated
    And ADMIN_EMAILS names an unverified active account that signed up after it
    When the seed runs, or the ops:seed-platform-operators upgrade step runs
    Then nobody is granted and nothing is recorded
    And the wait reason says the named account is not the install's first-created account, even once that one is deactivated

  # Erasure deletes the first account's row; user's erasure record keeps it first (Rogerio, 2026-10-19).
  @unit @operator-seed
  Scenario: With no email configured an erased first account seeds no later unverified sign-up
    Given the installation has no email configured
    And the install's first-created account has been erased
    And ADMIN_EMAILS names an unverified active account that signed up after it
    When the seed runs, or the ops:seed-platform-operators upgrade step runs
    Then nobody is granted and nothing is recorded
    And the wait reason says the named account is not the install's first-created account, even once that one is erased

  @unit @operator-seed
  Scenario: The upgrade step grants the verified users a still-set ADMIN_EMAILS names
    Given the installation has email configured
    And no platform operator holds the grant
    And ADMIN_EMAILS names a verified active user and an unverified one
    When the ops:seed-platform-operators upgrade step runs
    Then only the verified user is granted, by the system, with source migration
    And a dry run of the step grants nobody and counts the one user it would grant

  @unit @operator-seed
  Scenario: The upgrade step leaves every other case to the seed's wait
    Given one of: a holder exists, ADMIN_EMAILS is empty, it names no verified user, or the deployment is the hosted service
    When the ops:seed-platform-operators upgrade step runs
    Then nobody is granted and the step finishes

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

  # ============================================================================
  # The first user (Alex, 2026-10-10): a self-hosted install's first sign-up operates
  # ============================================================================

  @unit @operator-first-user
  Scenario: The first user of a self-hosted install becomes a platform operator
    Given a self-hosted install where nobody holds the platform-operator grant
    And ADMIN_EMAILS names somebody else
    When user's created fact arrives for the install's only user
    Then ops records the seed's decision naming that user, by the rule first-user
    And the recorded decision grants them as the system, as every seeded grant is

  @unit @operator-first-user
  Scenario: A second user never becomes an operator by signing up
    Given a self-hosted install where nobody holds the grant yet
    And another user already exists
    When user's created fact arrives for the second user
    Then nothing is recorded and nobody is granted

  @unit @operator-first-user
  Scenario: The hosted service never makes its first user an operator
    Given the hosted service
    When user's created fact arrives for its only user
    Then nothing is recorded and nobody is granted

  @unit @operator-first-user
  Scenario: An existing operator means no first-user grant
    Given a self-hosted install where somebody already holds the grant
    When user's created fact arrives for a user
    Then nothing is recorded and the holders stay as they were

  @unit @operator-first-user
  Scenario: Two users signing up at once never both become operators
    Given two users are created at once on a self-hosted install nobody operates
    When both created facts arrive
    Then a fact that finds more than one user records nothing
    And the seed's single recorded decision grants at most one user, however many records arrive

  @unit @operator-first-user
  Scenario: A backfilled or stale creation fact grants nobody
    Given user's created fact is a backfilled one, or names a user since erased or deactivated
    When it arrives
    Then nothing is recorded and nobody is granted

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

  @unit @operator-recovery
  Scenario: The recovery task refuses an account whose address was never verified
    Given the installation has email configured
    And an active account holds the address but never verified it
    When grant-platform-operator runs with that address, on any deployment
    Then it fails with platform_operator_user_not_found and nothing is granted

  @unit @operator-recovery
  Scenario: With no email configured the recovery task grants an unverified account
    Given the installation has no email configured, so no account can verify its address
    And the seed waits because the named unverified account is not the install's first-created account
    When grant-platform-operator runs with that account's address
    Then the account is granted by the system, since shell access naming it is the check
    And the seed's wait reason names the grant-platform-operator task
    And a deactivated account is still refused

  @unit @operator-recovery
  Scenario: The recovery task waits for a grant that is still being applied
    Given an active account holds the address
    And the grant is accepted but authz has not confirmed it within its own window
    When grant-platform-operator runs with that address
    Then it keeps reading the operators with backoff, logging its progress
    And it succeeds once the account is listed as an operator

  @unit @operator-recovery
  Scenario: The recovery task succeeds with a grant still being applied at its bound
    Given the grant is accepted but still not readable when the task's wait ends
    When grant-platform-operator runs with that address
    Then it exits cleanly, saying the grant is recorded and still being applied

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
  Scenario: The page refuses an account whose address was never verified
    Given a signed-in operator
    When they grant the role to an address whose account never verified it
    Then the refusal is platform_operator_user_not_found and nothing is granted

  @unit @operators-page
  Scenario: A refused grant never carries the address
    Given a signed-in operator
    When they grant the role to an address nobody active holds
    Then the refusal names no address, and carries the account id when one exists

  @unit @operators-page
  Scenario: An impersonated session cannot change who operates
    Given an operator impersonating a customer
    When they grant or revoke the role
    Then the refusal is ops_impersonated_operator_refused

  # ============================================================================
  # Staff only on the hosted cloud
  # ============================================================================
  # A deployment LangWatch runs is the seed's own "cloud" (IS_SAAS or Cloud admin); a developer's
  # local stack is exempt, as Cloud admin is always on there, so it can grant its seeded admin.

  @unit @operator-staff
  Scenario: On the hosted cloud the page and the task grant a verified staff account
    Given the hosted cloud
    And an active account whose verified address is on langwatch.ai
    When an operator grants it the role, or grant-platform-operator runs with its address
    Then the account is granted

  @unit @operator-staff
  Scenario: On the hosted cloud an account outside the staff domain is refused
    Given the hosted cloud
    And an active account whose verified address is on another domain, a subdomain or a lookalike
    When an operator grants it the role, or grant-platform-operator runs with its address
    Then the refusal is platform_operator_user_not_found and nothing is granted

  @unit @operator-staff
  Scenario: On the hosted cloud an unverified staff address is refused
    Given the hosted cloud
    And an active account whose address on langwatch.ai was never verified
    When an operator grants it the role, or grant-platform-operator runs with its address
    Then the refusal is platform_operator_user_not_found and nothing is granted

  @unit @operator-staff
  Scenario: A self-hosted install grants any verified active account
    Given a self-hosted install
    And an active account whose verified address is on the install's own domain
    When an operator grants it the role, or grant-platform-operator runs with its address
    Then the account is granted

  @unit @operator-staff
  Scenario: A developer's local stack grants its own seeded admin
    Given a local development stack running as the hosted cloud
    And the seeded admin's verified address is not on langwatch.ai
    When grant-platform-operator runs with that address
    Then the account is granted

  # ============================================================================
  # A self-hosted operator is not LangWatch staff
  # ============================================================================
  # Every grant path writes the one platform-operator role (ops:view, ops:manage). What only
  # LangWatch staff do on the hosted cloud (licences, self-hosted instances, subscriptions, the
  # bug-report inbox) is Cloud admin, behind ops's cloud-ops capability, not behind the role.
  # Switching it on needs the private key of the release's licence public key (cloud-ops.feature).

  @unit @operator-scope
  Scenario: A self-hosted operator is refused Cloud admin
    Given a self-hosted install, where the cloud-ops capability is off
    And a user the seed, the recovery task or the page granted the platform-operator role
    When they ask for a Cloud admin surface
    Then the call is refused with not_found, though they hold ops:view and ops:manage

  @unit @operator-scope
  Scenario: A grant names the account and nothing more
    When the page or authz is asked to grant the platform-operator role with a role, a permission or a scope beside the account
    Then the input is refused before anything is granted
    And no grant path can confer more than ops:view and ops:manage
