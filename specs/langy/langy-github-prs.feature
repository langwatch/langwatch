Feature: Langy opens GitHub PRs via the installed GitHub App
  As a LangWatch user chatting with Langy
  I want Langy to open GitHub pull requests on my organization's repositories
  So that agent-made changes land as real, reviewable PRs

  # Attribution is BOT-AUTHORED (settled product decision). The pull request and
  # its commits are authored by the LangWatch GitHub App. Commits carry a
  # Co-authored-by trailer for the requesting user, and the PR body notes
  # "Requested by @<login> via LangWatch". There is no per-user GitHub OAuth and
  # no user access token anywhere — the installation is the whole access
  # boundary. Tokens are 1-hour installation tokens minted per turn in the
  # control plane and never persisted.

  Background:
    Given I am signed in to LangWatch
    And my organization has installed the LangWatch GitHub App on repository "acme/service-x"

  @integration
  Scenario: Org without an installation gets a connect card, not an error
    Given my organization has not installed the LangWatch GitHub App
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy renders the in-chat Install GitHub App card
    And Langy does not report an error
    And no pull request is created

  @integration @e2e
  Scenario: A turn on an installed org opens a bot-authored PR
    When I ask Langy to fix a file in "acme/service-x" and open a PR
    Then a pull request is created on "acme/service-x"
    And the pull request author on GitHub is the LangWatch app
    And the commits carry a Co-authored-by trailer for my GitHub login
    And the pull request body notes it was requested by me via LangWatch
    And Langy renders the PR as a card in chat

  @integration
  Scenario: The minted token is scoped to the installation and self-expires
    When Langy mints a GitHub token for a turn on "acme/service-x"
    Then the token is an installation token bounded to the installation's repositories
    And the token grants only contents:write and pull_requests:write
    And the token expires within one hour
    And no GitHub token is persisted anywhere

  @integration
  Scenario: A known single repository narrows the token scope
    Given the turn context carries the explicit repository "acme/service-x"
    When Langy mints a GitHub token for the turn
    Then the token is scoped to only "acme/service-x"

  @integration
  Scenario: Langy fails fast when the agent is completely unreachable
    Given the agent backend is completely unreachable
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy tells me it is temporarily unavailable within a few seconds
    And no daily PR permit is consumed

  @integration
  Scenario: Langy does not retry when the agent rejects the request
    Given the agent backend rejects the request with a 4xx response
    When I ask Langy to open a PR on "acme/service-x"
    Then Langy does not retry the request
    And Langy reports the failure

  @integration @e2e
  Scenario: Tokens never persist in the worker or repo clone
    When Langy completes a PR-opening task in my session
    Then the worker home directory contains no copy of the installation token
    And the repository clone contains no credential files
    And the clone directory is deleted when the worker is reaped

  @integration @e2e
  Scenario: Installation scoping bounds reachable repositories
    Given the GitHub App is not installed on repository "acme/other-repo"
    When I ask Langy to open a PR on "acme/other-repo"
    Then no pull request is created on "acme/other-repo"
    And Langy explains the repository is not available to the LangWatch app

  @integration
  Scenario: Changing the resolved repository scope re-warms the worker
    Given a Langy worker is running for my conversation scoped to "acme/service-x"
    When the resolved repository scope for the next turn changes
    Then the worker is re-warmed with the new scope rather than reused

  @integration
  Scenario: Removing the installation cuts off new sessions
    Given a Langy worker is running with an installation token in its env
    When my organization uninstalls the LangWatch GitHub App
    Then the worker still holds the token until it is reaped
    And the next Langy turn cannot mint a GitHub token
    And Langy renders the Install GitHub App card if I ask for a PR

  @integration
  Scenario: Live steps card reflects the worker's progress
    When I ask Langy to open a PR on "acme/service-x"
    Then a steps card appears in chat showing the cloning step
    And the card progresses through branched, committed, pushed
    And the steps card shows the opened step when the PR URL arrives
    And no raw "[langy:progress:" markers appear in my chat history

  @integration
  Scenario: Per-user daily PR cap stops runaway loops
    Given I have already opened 20 PRs via Langy today
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
