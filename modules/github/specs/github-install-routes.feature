Feature: GitHub routes answer through the installed module
  The process mounts the github module's declared transports over the one
  implementation boot constructed, so every route reaches that implementation.

  @regression
  Scenario: the installed module answers the GitHub App Setup URL
    Given the github module is installed over memory stores
    When GitHub calls the Setup URL without a signed state
    Then the route answers 400 rather than failing inside the handler

  @unimplemented
  Scenario: the installed module answers the connection procedures
    Given the github module is installed over memory stores
    When an organization member reads the GitHub connection status
    And a project with no organization reads its live pull-request statuses
    Then each procedure answers from the installed module
