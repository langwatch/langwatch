Feature: Why a member is here, ranked so the strongest reason wins
  As an administrator reading the people in my organization
  I need each member's reason for being here to be the one that decides whether they stay
  So that a directory-managed person is never shown as merely invited

  # The chips and the drawer sentence: specs/identity/directory-administration.feature.

  @unit
  Scenario: A member a directory created is the directory's, whatever else is true
    Given "sam" was created by "acme"'s directory and also accepted an invitation
    When the reasons for "acme"'s members are worked out
    Then "sam" is here because of the directory, naming its provider

  @unit
  Scenario: A member single sign-on admitted is explained by that connection
    Given "ivy" was admitted when she first signed in through "acme"'s single sign-on
    And her address also matches "acme"'s domain
    When the reasons for "acme"'s members are worked out
    Then "ivy" is here because of single sign-on, naming the connection

  @integration
  Scenario: The person drawer explains a single sign-on joiner
    Given "ivy" joined "acme" through single sign-on
    When "ana" opens "ivy" in the person drawer
    Then it says she joined through single sign-on
    And it does not say that nothing on record explains her
