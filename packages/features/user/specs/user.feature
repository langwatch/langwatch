Feature: Canonical user lifecycle

  Scenario: Deactivating a user invalidates every session family
    When the User service deactivates an active user
    Then the user is marked deactivated
    And browser sessions are revoked
    And CLI tokens are revoked

  Scenario: Changing an email refreshes authenticated identity
    When an authorized transport changes a user's normalized email through the User service
    Then the profile is updated
    And browser sessions are revoked

  Scenario: Uploading an avatar uses the personal workspace
    Given a valid avatar image
    When the User service sets the avatar
    Then Organization supplies the user's personal project
    And the bytes are stored with the user-avatar purpose
    And the User service stores the compatibility delivery URL

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
