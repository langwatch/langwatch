@unit
Feature: githubsim, a local stand-in for GitHub
  The github module reads installations, mints installation tokens, lists
  repositories and pull requests, and receives signed webhooks; the coding-agent
  rows depend on all of it. githubsim answers those calls from scriptable state,
  serves the App install page that redirects to the stack's setup URL, serves
  the OAuth authorize, token and user calls, and sends HMAC-signed webhooks to
  the stack. It checks no JWT signature.

  # Bound by Go tests in services/sims/githubsim/githubsim_test.go and gh_test.go,
  # services/langyagent/adapters/github and adapters/pi,
  # tools/thuishaven/domain/overlay_github_test.go and
  # tools/thuishaven/app/plan_github_test.go, and by the host-origin tests in
  # modules/github/process/src/rules/__tests__/github-host.rules.unit.test.ts and
  # modules/github/contract/src/__tests__/github.config.unit.test.ts.

  Scenario: An installation mints a token that lists repositories and pull requests
    Given githubsim is running with its seed
    When the product asks for the installation and mints a token with a JWT naming the App
    Then the token lists the installation's repositories and reads its pull requests by head branch
    And a pull request that does not exist answers 404

  Scenario: Credentials and permissions are refused the way GitHub refuses them
    Given githubsim is running with its seed
    When a call carries no token, another App's JWT, an expired JWT or an unknown token
    Then githubsim answers 401
    And a token minted for read cannot open a pull request and gets 403 Resource not accessible by integration
    And a mint asking for a permission the installation lacks answers 422
    And a suspended installation answers 403 to a mint and to its tokens
    And an expired installation token answers 401

  Scenario: A scripted failure answers matching calls
    Given githubsim is running with its seed
    When a fault for 429 with Retry-After 30 is added for the pull request calls, once
    Then the first pull request call answers 429 with Retry-After and an exhausted rate limit
    And the next one answers normally
    And faults for 401, 403, 404, 422, 500 and 503 answer those statuses with GitHub's error body

  Scenario: Pull requests open, change state and carry check runs
    Given githubsim is running with its seed
    When a token opens a pull request, merges it from the control API and posts a check run
    Then a second pull request on the same head branch answers 422
    And the pull request reads back closed and merged
    And the check run lists under its commit

  Scenario: Webhooks are signed over the exact body and can be sent wrong
    Given githubsim is running with a webhook target and secret
    When a pull request is merged with delivery
    Then the target receives the pull_request event with a valid X-Hub-Signature-256 and the installation, repository and head branch
    And a delivery marked bad-signature does not verify
    And a delivery marked omit-signature carries no signature header
    And a target that answers 401 is reported in the delivery history
    And an event githubsim cannot build answers 422

  Scenario: The install page redirects to the stack's setup URL
    Given githubsim knows the stack's setup URL
    When a browser opens the App install page for an account
    Then it is redirected to the setup URL with installation_id, setup_action install and the same state
    And the installation exists with a default repository

  Scenario: OAuth sign-in gives a user
    Given githubsim is running
    When a browser is sent through authorize and the code is exchanged
    Then the token reads the user and their verified email
    And the code works once

  Scenario: Control state resets to the seed and unknown paths are GitHub 404s
    Given githubsim is running with its seed and has been changed
    When the control API resets it
    Then the seed installation and pull request are all that remain
    And an unknown path answers GitHub's JSON 404, not the page

  Scenario: haven runs githubsim only when the worktree asks for it
    Given a stack that has not asked for +github
    Then no GitHub settings are set for the product
    When the worktree selects github
    Then the product gets the App id, slug, key, webhook secret and the sim's API and web origins
    And the sim is told the stack's webhook and setup URLs and the same secret

  Scenario: +github wins over a real GitHub App in .env
    Given the root .env names a real GITHUB_LANGY_APP_ID, key and webhook secret
    When the stack starts with +github
    Then the App id, slug, private key, webhook secret and both origins come from githubsim
    And the sim's signed webhooks verify against the secret the stack holds

  Scenario: The github module honours stand-in origins
    Given GITHUB_LANGY_API_BASE and GITHUB_LANGY_WEB_BASE name a stand-in
    Then the API, web and install URLs use them in place of the host's
    And a blank value means GitHub itself, and a value that is not a URL is refused at boot

  Scenario: git clones and pushes a seeded repository over smart HTTP
    Given githubsim seeds langwatch-demo/app
    When git clones it with an installation token as the password
    Then the clone holds a README on main
    And a branch pushed with the same token is in the sim's repository
    And a clone without a token is refused, and a repository outside the installation is not found

  Scenario: gh opens a pull request against githubsim over its enterprise-host API
    Given gh names githubsim as its host, with the installation token
    When gh looks up the repository, checks the branch for a pull request and creates one
    Then each answer has the shape gh 2.100 reads
    And the new pull request is in the sim's list, and a second one for the same branch is refused
    And a repository outside the installation answers GitHub's NOT_FOUND error

  Scenario: Langy's worker reaches githubsim when the stack names it as the GitHub host
    Given the stack runs +github and +langy
    Then the langyagent lane gets LANGY_GITHUB_HOST, the sim's host and port
    And the worker's env carries GH_HOST, GH_ENTERPRISE_TOKEN, a git rewrite of github.com to the sim and a NO_PROXY entry for it
    And with the host blank the worker gets GH_TOKEN for github.com as before
