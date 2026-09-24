Feature: GitHub routes answer through the installed module
  The process mounts the github module's declared transports over the one
  implementation boot constructed, so every route reaches that implementation.

  @regression
  Scenario: the installed module answers the GitHub App Setup URL
    Given the github module is installed over memory stores
    When GitHub calls the Setup URL without a signed state
    Then the route answers 400 rather than failing inside the handler

  @regression
  Scenario: the Setup URL refuses a signed state brought back by someone else
    Given the github module is installed over memory stores
    And an installation flow was signed for one person
    When GitHub redirects to the Setup URL on a request where another person is signed in
    Then the route answers 401 because the session changed mid-flow

  @regression
  Scenario: the Setup URL refuses a person who can no longer manage the organization
    Given the github module is installed over memory stores
    And an installation flow was signed for one person
    And that person can no longer manage the organization
    When GitHub redirects to the Setup URL on that person's signed-in request
    Then the route answers 403

  @unimplemented
  Scenario: a completed installation is recorded, audited and relinks pull requests
    Given the github module is installed over memory stores
    And an installation flow was signed for an organization manager
    When GitHub redirects to the Setup URL with the new installation
    Then the installation is recorded against the organization
    And the audit log receives the install line
    And the organization's coding-agent pull requests are relinked

  @unimplemented
  Scenario: disconnecting records the disconnect in the audit log
    Given the github module is installed over memory stores
    And the organization has a GitHub installation
    When an organization manager disconnects it
    Then the audit log receives the disconnect line

  @unimplemented
  Scenario: the installed module answers the connection procedures
    Given the github module is installed over memory stores
    When an organization member reads the GitHub connection status
    And a project with no organization reads its live pull-request statuses
    Then each procedure answers from the installed module
