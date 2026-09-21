Feature: Canonical user lifecycle

  @unit
  Scenario: Deactivating a user invalidates every session family
    When the User service deactivates an active user
    Then the user is marked deactivated
    And browser sessions are revoked
    And CLI tokens are revoked

  Scenario: Changing an email refreshes authenticated identity
    When an authorized transport changes a user's normalized email through the User service
    Then the profile is updated
    And browser sessions are revoked

  @unit
  Scenario: Uploading an avatar uses the personal workspace
    Given a valid avatar image
    When the User service sets the avatar
    Then Organization supplies the user's personal project
    And the bytes are stored with the user-avatar purpose
    And the User service stores the compatibility delivery URL

  Rule: Every backend the feature stores accounts in answers the same way

    @unit
    Scenario: The memory and Postgres user repositories answer alike
      Given the same accounts written to each backend
      When the same reads and writes run against every backend
      Then each answers the same profiles, the same absences, and the same refusal of a second first password

    @unit
    Scenario: The memory and Postgres credential repositories answer alike
      Given a person holding one sign-in method in each backend
      When the same reads and writes run against every backend
      Then each refuses to unlink the last method, lists the method without its password, and stores a rotated hash on the same row

  # The stored password hash is the one column in this feature that must not
  # travel. It used to: the API process read it on its own connection and the
  # comparison happened in a transport, which meant the rule about that column
  # lived nowhere in particular.
  @integration
  Scenario: Credential password hashes never leave the user feature
    Given a signed-in person who holds a credential sign-in method
    When they change their password
    Then the current password is verified and the new one stored in one operation
    And the stored hash is read and written by the User feature's own persistence
    And the process composing the request never reads the account rows itself
    And what the operation answers with is the outcome, never the stored hash

  # There was no way to end a session anywhere in the product: somebody who
  # signed in on a shared machine, lost a laptop or suspected a stolen cookie
  # had no action available, and the account surface offered none.

  @unit
  Scenario: The account surface serves the browsers somebody is signed in on
    Given a signed-in person holding several browser sessions
    When they open their account's devices list
    Then the browsers are served under the user namespace with their sign-in method and last activity
    And the browser making the request is marked as the current one

  @unit
  Scenario: Ending one browser session is a mutation on the caller's own account
    Given a signed-in person reading their devices list
    When they end one of the other browsers
    Then that session alone is ended
    And the request names no account, so nobody else's session is reachable
