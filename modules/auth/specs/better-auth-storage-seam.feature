Feature: Better Auth's storage seam
  Better Auth's storage adapter and its session cache are built where a store
  client crosses into auth: its repository registry (ARCHITECTURE.md section 3.2,
  the named raw-client exception, round 5 Q212). Every tier has a real twin.

  @integration
  Scenario: A browser session survives a restart over the registry-built adapter
    Given auth is composed over the live repository registry on Postgres and Redis
    And a user has signed in with email and password
    When auth is composed again over the same stores
    Then the first sign-in's session cookie still reads that user's session

  @integration
  Scenario: The live adapter declares native transactions to single sign-on
    Given auth is composed over the live repository registry
    Then the storage Better Auth is handed declares native transaction support

  @unit
  Scenario: The memory tier signs in without a database
    Given auth is composed over the memory repository registry
    When a user signs up and then signs in with email and password
    Then a session is issued that reads back that user

  @unit
  Scenario: A wrong password on the memory tier is refused, not thrown
    Given auth is composed over the memory repository registry
    And a user has signed up with email and password
    When someone signs in as that user with a different password
    Then the sign-in is refused as invalid credentials
    And no session is issued

  @unit
  Scenario: The session cache lives in the registry's secondary storage
    Given auth is composed over the memory repository registry
    When a user signs in
    Then the session is cached in the memory secondary storage the registry built
