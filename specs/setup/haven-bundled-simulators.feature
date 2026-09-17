Feature: Haven carries its development simulators
  Mail and identity providers belong to the installed Haven tool, so they work
  when a developer starts a stack from an older checkout.

  @unit @regression
  Scenario: Simulator lanes run Haven's bundled code in every checkout
    Given a checkout without simulator source or a service Makefile
    When Haven plans mail and identity providers with or without Go source watching
    Then both run as supervised children of the Haven executable
    And they retain their stack's ports, URLs, logs and inbox storage

  @integration @regression
  Scenario: Bundled simulators serve browsers without a checkout or build tools
    Given an installed Haven binary in a directory without source or build tools
    When its mail and identity simulator children start
    Then the mail inbox accepts SMTP and serves captured messages in the browser
    And the identity provider serves its browser page and OIDC discovery
    And its browser form generates a directory while keeping the seeded login accounts
    And an oversized directory request is refused without changing the directory
    And cancelling each child releases its listeners

  @unit
  Scenario: An invalid bundled simulator invocation is refused
    When a simulator child names an unknown simulator or unexpected arguments
    Then Haven refuses the invocation with an actionable error

  @unit
  Scenario: A bundled simulator reports invalid configuration
    Given an invalid mail message limit or identity tenant count
    When that simulator child starts
    Then it exits with an error naming the invalid setting
