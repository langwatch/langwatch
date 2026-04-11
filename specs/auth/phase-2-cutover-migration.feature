@integration
Feature: BetterAuth additive schema migration
  As a LangWatch maintainer
  I want the database schema forward-compatible with BetterAuth
  So that Phase 3 can swap the auth stack without a separate schema migration step

  # This phase ships two artifacts:
  # 1. `prisma/migrations/20260410230000_better_auth_additive/migration.sql`
  # 2. `prisma/schema.prisma` updated to include the new columns
  #
  # Only ADDITIVE changes in Phase 2 — nothing is dropped, renamed, or typed.
  # The destructive cutover (dropping User.password, converting emailVerified,
  # truncating Session) happens atomically with the consumer swap in Phase 3.

  Background:
    Given the langwatch Postgres database is running
    And the existing NextAuth-compatible schema is applied

  # ============================================================================
  # Column additions (all IF NOT EXISTS for idempotency)
  # ============================================================================

  Scenario: Account.password column added
    When I apply the additive migration
    Then the "Account" table has a "password" column of type TEXT
    And the "password" column is nullable

  Scenario: Account.type has a default value
    When I apply the additive migration
    Then the "Account"."type" column has a default of "oauth"
    And existing rows keep their previous value

  Scenario: Session has ipAddress, userAgent, createdAt, updatedAt
    When I apply the additive migration
    Then the "Session" table has an "ipAddress" column of type TEXT
    And a "userAgent" column of type TEXT
    And a "createdAt" column of type TIMESTAMP with a default of now()
    And an "updatedAt" column of type TIMESTAMP with a default of now()

  Scenario: VerificationToken gets an id primary key and timestamps
    When I apply the additive migration
    Then the "VerificationToken" table has an "id" column as its primary key
    And existing rows have a non-null id
    And "createdAt" and "updatedAt" columns exist

  # ============================================================================
  # Non-regression: everything the app depends on today still works
  # ============================================================================

  Scenario: NextAuth credentials signin still works after the migration
    Given the migration has been applied
    And a user exists with a bcrypt password on the User table
    When the user signs in via NextAuth credentials provider
    Then they receive a valid session
    And their session row in "Session" is created with createdAt/updatedAt timestamps
    And the session row has a nullable ipAddress and userAgent

  Scenario: NextAuth Auth0 OAuth signin still works after the migration
    Given the migration has been applied
    And an organization exists with ssoDomain "acme.com" and ssoProvider "waad|acme-connection"
    When a user from acme.com signs in via Auth0
    Then they are added to the organization as a MEMBER (new user case)
    And the Account row is written

  Scenario: The Prisma client regenerates cleanly
    When I run "pnpm prisma:generate:typescript"
    Then it exits with code 0
    And the generated client reflects the new columns

  Scenario: Typecheck passes after the schema change
    When I run "pnpm typecheck"
    Then no new errors appear in the langwatch app (packages/* may have pre-existing errors)

  # ============================================================================
  # Idempotency
  # ============================================================================

  Scenario: Applying the migration twice is a no-op
    Given the migration has already been applied once
    When I try to apply it again
    Then all ADD COLUMN statements are skipped via IF NOT EXISTS
    And no error is raised
    And no data is modified
