Feature: Passwords held by Auth0 move into LangWatch
  As somebody who signs in to LangWatch with an email and a password
  I need the password I already use to keep working once LangWatch holds it
  So that moving off Auth0 is something I never notice

  # ADR-143. Auth0's export carries each database-connection (`auth0|...`)
  # account's bcrypt hash. It is adopted as-is, never rehashed, through the
  # same writes a first password takes, so an account the identity backfill
  # has finalized gets its credential identifier stated as an event and its
  # hash in the credential store, and one it has not gets the legacy row the
  # backfill adopts later. Replaying the identity events never touches a hash.

  @unit
  Scenario: An imported hash becomes the password the person already has
    Given "sam" signs in through Auth0's database connection and has no password here
    When Auth0's hash for "sam" is imported
    Then "sam" holds exactly that hash, not a hash of it

  @unit
  Scenario: An imported hash fills the placeholder a passkey sign-up left
    Given "sam" signed up with a passkey and has never had a password
    When Auth0's hash for "sam" is imported
    Then the placeholder holds the hash and no second credential is created

  @unit
  Scenario: An import never overwrites a password held here
    Given "sam" already has a password here
    When Auth0's hash for "sam" is imported
    Then it is skipped and the existing password is untouched

  @unit
  Scenario: An import signs nobody out
    Given "sam" is signed in
    When Auth0's hash for "sam" is imported
    Then no session ends, because the password has not changed

  @unit
  Scenario: A dry run says what an import would do and writes nothing
    Given "sam" has no password here
    When the import is planned for "sam"
    Then it reports that a credential would be created
    And nothing is written

  @unit
  Scenario: An import finds the person by their Auth0 id
    Given "sam" signs in through Auth0 as "auth0|abc"
    When the import looks up "auth0|abc"
    Then it finds "sam"
    And an id nobody holds finds nobody
