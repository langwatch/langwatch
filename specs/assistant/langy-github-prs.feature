Feature: Langy opens GitHub PRs as the requesting user
  As a LangWatch user chatting with Langy
  I want Langy to open GitHub pull requests attributed to me
  So that agent-made changes land as real, reviewable PRs under my name

  Background:
    Given I am signed in to LangWatch
    And my organization has installed the LangWatch GitHub App on repository "acme/service-x"

  @unimplemented
  Scenario: User connects GitHub via settings
    When I click "Connect GitHub" in settings
    And I authorize the LangWatch GitHub App as my GitHub user
    Then settings shows my GitHub login as connected
    And an encrypted refresh token is stored for my user and organization
    And no GitHub access token is persisted anywhere

  @unimplemented
  Scenario: Connected user asks Langy to open a PR
    Given I have connected my GitHub account
    When I ask Langy to fix a file in "acme/service-x" and open a PR
    Then a pull request is created on "acme/service-x"
    And the pull request author on GitHub is my GitHub user
    And the branch commits are attributed to my GitHub login

  @unimplemented
  Scenario: Unconnected user gets a connect link, not an error
    Given I have not connected my GitHub account
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy replies with a link to connect GitHub in settings
    And Langy does not report an error
    And no pull request is created

  @unimplemented
  Scenario: Tokens never persist in the worker or repo clone
    Given I have connected my GitHub account
    When Langy completes a PR-opening task in my session
    Then the worker home directory contains no copy of my GitHub token
    And the repository clone contains no credential files
    And the clone directory is deleted when the worker is reaped

  @unimplemented
  Scenario: Revoking the connection cuts off new sessions immediately
    Given I have connected my GitHub account
    When I disconnect GitHub in settings
    Then my stored GitHub credential is deleted
    And the authorization is revoked at GitHub
    And my next Langy session cannot mint a GitHub token
    And Langy replies with the connect link if I ask for a PR

  @unimplemented
  Scenario: Installation scoping bounds reachable repositories
    Given I have connected my GitHub account
    And the GitHub App is not installed on repository "acme/other-repo"
    When I ask Langy to open a PR on "acme/other-repo"
    Then no pull request is created on "acme/other-repo"
    And Langy explains the repository is not available to the LangWatch app
