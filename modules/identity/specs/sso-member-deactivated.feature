Feature: A member the directory turned off is told why single sign-on refused them
  As somebody whose organization's directory has turned off my access
  I need the sign-in screen to say that, rather than that my account is not linked
  So that I ask an administrator instead of trying another way in

  @unit
  Scenario: A member the directory turned off is told so
    Given "acme"'s directory holds "sam" as inactive
    When "sam" signs in through "acme"'s connection
    Then sign-in is refused with the code "sso_member_deactivated"
    And nothing is linked and no session is created

  @integration
  Scenario: The deactivated refusal reaches the sign-in screen in plain words
    Given a sign-in refused with "sso_member_deactivated"
    When the sign-in screen shows the refusal
    Then it reads "Your access has been turned off"
    And it tells the reader to ask an administrator of their organization
    And it does not send them back to their identity provider
