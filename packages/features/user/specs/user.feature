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
