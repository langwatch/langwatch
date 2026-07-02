Feature: Langy opens GitHub PRs as the requesting user
  As a LangWatch user chatting with Langy
  I want Langy to open GitHub pull requests attributed to me
  So that agent-made changes land as real, reviewable PRs under my name

  Background:
    Given I am signed in to LangWatch
    And my organization has installed the LangWatch GitHub App on repository "acme/service-x"

  @integration
  Scenario: User connects GitHub via settings
    When I click "Connect GitHub" in settings
    And I authorize the LangWatch GitHub App as my GitHub user
    Then settings shows my GitHub login as connected
    And an encrypted refresh token is stored for my user and organization
    And no GitHub access token is persisted anywhere

  @integration
  Scenario: User connects GitHub via the in-chat card
    Given Langy has surfaced the Connect GitHub card
    When I click "Connect GitHub" in the card and authorize the App in the popup
    Then the popup closes and the chat continues without losing my message
    And settings shows my GitHub login as connected
    And the "Acting as @login" chip appears in the sidebar footer

  @integration
  Scenario: Unconnected user gets a connect card, not an error
    Given I have not connected my GitHub account
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy renders the in-chat Connect GitHub card
    And Langy does not report an error
    And no pull request is created

  @integration @e2e
  Scenario: Connected user asks Langy to open a PR
    Given I have connected my GitHub account
    When I ask Langy to fix a file in "acme/service-x" and open a PR
    Then a pull request is created on "acme/service-x"
    And the pull request author on GitHub is my GitHub user
    And the branch commits are attributed to my GitHub login
    And Langy renders the PR as a card in chat

  @integration
  Scenario: Langy fails fast when the agent is completely unreachable
    Given I have connected my GitHub account
    And the agent backend is completely unreachable
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy tells me it is temporarily unavailable within a few seconds
    And no daily PR permit is consumed

  @integration
  Scenario: Langy does not retry when the agent rejects the request
    Given I have connected my GitHub account
    And the agent backend rejects the request with a 4xx response
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy does not retry the request
    And Langy reports the failure

  @integration @e2e
  Scenario: Tokens never persist in the worker or repo clone
    Given I have connected my GitHub account
    When Langy completes a PR-opening task in my session
    Then the worker home directory contains no copy of my GitHub token
    And the repository clone contains no credential files
    And the clone directory is deleted when the worker is reaped

  @integration
  Scenario: Revoking the connection cuts off new sessions immediately
    Given I have connected my GitHub account
    When I disconnect GitHub in settings
    Then my stored GitHub credential is deleted
    And my next Langy session cannot mint a GitHub token
    And Langy renders the Connect GitHub card if I ask for a PR

  @integration @e2e
  Scenario: Installation scoping bounds reachable repositories
    Given I have connected my GitHub account
    And the GitHub App is not installed on repository "acme/other-repo"
    When I ask Langy to open a PR on "acme/other-repo"
    Then no pull request is created on "acme/other-repo"
    And Langy explains the repository is not available to the LangWatch app

  @integration
  Scenario: Live workers may keep a token until the idle reaper runs
    Given I have connected my GitHub account
    And a Langy worker is running with my GitHub token in its env
    When I disconnect GitHub in settings
    Then the worker still holds the token until it is reaped
    And the idle reaper reaps the worker within 10 minutes of idleness

  @integration
  Scenario: Live steps card reflects the worker's progress
    Given I have connected my GitHub account
    When I ask Langy to open a PR on "acme/service-x"
    Then a steps card appears in chat showing the cloning step
    And the card progresses through branched, committed, pushed
    And the steps card shows the opened step when the PR URL arrives
    And no raw "[langy:progress:" markers appear in my chat history

  @integration
  Scenario: Per-user daily PR cap stops runaway loops
    Given I have connected my GitHub account
    And I have already opened 20 PRs via Langy today
    When I ask Langy to open another PR
    Then Langy reports the daily cap is reached
    And no pull request is created until the cap resets

  @integration
  Scenario: Permit must be released on every non-PR exit
    Given a PR-cap permit has been reserved for the current request
    When the request errors before any PR is opened
    Then the permit is released back to the daily counter
    And the user's remaining daily cap is unchanged

  @integration
  Scenario: Invalid modelOverride must NOT burn a permit
    Given the project's allowlist excludes the requested model
    When the user asks Langy with that modelOverride
    Then the request fails the allowlist check with 400
    And no permit was reserved against the daily counter
