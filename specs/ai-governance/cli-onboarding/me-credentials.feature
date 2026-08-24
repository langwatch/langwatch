Feature: /me credentials just work - CLI credential resolution after device login
  As a developer who signed in with `langwatch login` (device flow)
  I want every API-calling CLI command to work with zero env vars
  So that my personal project is usable immediately, without hunting for an API key

  # Background
  #
  # Device login stores a session in ~/.langwatch/config.json and the server
  # ensures a personal workspace (team + project) for the user. The personal
  # project is a normal project with a normal apiKey, so commands like
  # `langwatch trace search` can authenticate with it directly. The CLI
  # resolves credentials in a fixed priority order and tells the user, on
  # stderr, which identity a command ran as.
  #
  # Resolution order (highest wins):
  #   1. explicit --api-key value handed to the resolver by a command
  #   2. LANGWATCH_API_KEY from the environment or the caller's .env
  #      (scoped load: only LANGWATCH_* keys are read from .env)
  #   3. the device session in ~/.langwatch/config.json, which resolves the
  #      personal project's API key

  Background:
    Given the `langwatch` CLI is installed

  # ─────────────────────────────────────────────────────────────────────
  # Resolution order
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @credentials @unit
  Scenario: a device session resolves the personal project API key when no env var is set
    Given ~/.langwatch/config.json holds a device session with a cached personal project key
    And the cached key was validated within the revalidation window
    And LANGWATCH_API_KEY is not set anywhere
    When any API-calling command resolves credentials
    Then the resolved API key is the personal project's key
    And the resolved mode is device session

  # ─────────────────────────────────────────────────────────────────────
  # Revocation cannot be bypassed by the cached key
  #
  # The cached key is a long-lived Project.apiKey, not a session-bound token,
  # so trusting it forever would let a stolen ~/.langwatch/config.json keep
  # working after the device was revoked from the devices inventory. The resolver trusts
  # the cache only within a short window; past it, it re-confirms the session
  # is live before using the key, and drops the key when the session is gone.
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @credentials @revocation @unit
  Scenario: a device session uses the cached key without a network call while validation is fresh
    Given a cached personal project key validated less than the revalidation window ago
    When any API-calling command resolves credentials
    Then the cached key is used
    And no session-authenticated revalidation request is made

  @bdd @cli-onboarding @credentials @revocation @unit
  Scenario: a stale cached key is revalidated before use
    Given a cached personal project key whose validation is older than the revalidation window
    When any API-calling command resolves credentials
    And the session is still live
    Then the CLI re-confirms the session through GET /api/auth/cli/personal-project
    And it refreshes the cached key and the validation clock before using it

  @bdd @cli-onboarding @credentials @revocation @integration
  Scenario: device-session revocation severs CLI access and wipes the cached key
    Given a device login whose cached key's validation is past the window
    When the device is revoked from the devices inventory (its Redis tokens are dropped)
    And the next data command resolves credentials
    Then the session-authenticated revalidation fails with 401
    And the command reports the not-logged-in error
    And the cached personal project key is deleted from ~/.langwatch/config.json
    # so a copied config is now inert

  @bdd @cli-onboarding @credentials @revocation @unit
  Scenario: a transient/offline revalidation keeps the last-known key without extending trust
    Given a stale cached key and an unreachable control plane
    When the resolver tries to revalidate and the request errors (not a 401)
    Then the last-known key is used for this command
    And the validation clock is NOT advanced, so the next reachable command revalidates again

  @bdd @cli-onboarding @credentials @unit
  Scenario: LANGWATCH_API_KEY beats the stored device session
    Given ~/.langwatch/config.json holds a device session with a cached personal project key
    And LANGWATCH_API_KEY is exported in the environment
    When any API-calling command resolves credentials
    Then the resolved API key is the environment's value
    And the resolved mode is api key

  @bdd @cli-onboarding @credentials @unit
  Scenario: an explicit --api-key value beats the environment
    Given LANGWATCH_API_KEY is exported in the environment
    When a command resolves credentials with an explicit api key argument
    Then the resolved API key is the explicit argument
    And the environment value is not used

  @bdd @cli-onboarding @credentials @unit
  Scenario: the caller's .env still contributes only LANGWATCH_* keys (daemon constraint)
    Given the caller's .env contains LANGWATCH_API_KEY and an unrelated secret like DATABASE_URL
    When credentials are resolved
    Then LANGWATCH_API_KEY from .env is honoured
    And DATABASE_URL is never loaded into the process environment

  # ─────────────────────────────────────────────────────────────────────
  # Personal key delivery
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @credentials @integration
  Scenario: device-login exchange delivers the personal project key and the CLI stores it
    Given a device code was approved for a user with a personal workspace
    When the CLI polls POST /api/auth/cli/exchange
    Then the device_session response includes personal_project with id, slug, name and api_key
    And the CLI persists personal_project into ~/.langwatch/config.json

  @bdd @cli-onboarding @credentials @integration
  Scenario: a session created before this change lazily exchanges once and rewrites the session file
    Given ~/.langwatch/config.json holds a device session without a personal project key
    When an API-calling command resolves credentials
    Then the CLI calls GET /api/auth/cli/personal-project with its bearer token
    And the personal project key is written back into ~/.langwatch/config.json
    And subsequent commands resolve the key from disk without a network call

  @bdd @cli-onboarding @credentials @integration
  Scenario: the lazy exchange refreshes an expired access token before giving up
    Given the stored access token is expired and a valid refresh token exists
    When the lazy personal-project exchange runs
    Then the CLI refreshes the session first
    And the rotated tokens are persisted
    And the exchange succeeds with the refreshed token

  @bdd @cli-onboarding @credentials @integration
  Scenario: GET /api/auth/cli/personal-project returns the caller's personal project
    Given a valid device-session bearer token whose personal workspace already exists
    And the user is an active member of the token's organization
    When the CLI calls GET /api/auth/cli/personal-project
    Then the response carries the personal project's id, slug, name and api_key
    And it is the same project the login exchange delivered

  # ─────────────────────────────────────────────────────────────────────
  # Tenancy boundary: current membership is proven before minting a key
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @credentials @tenancy @integration
  Scenario: an offboarded user's pre-removal token cannot mint or return a personal key
    Given a device-session token issued while the user was a member of an organization
    And the user is then removed from that organization
    When the CLI calls GET /api/auth/cli/personal-project with that token
    Then the response is 403
    And no personal team, project, or role binding is created in the former tenant
    And the presented access token is revoked from Redis
    And a follow-up call with the same token is 401

  @bdd @cli-onboarding @credentials @tenancy @integration
  Scenario: a disabled member's pre-disable token cannot mint or return a personal key
    Given a device-session token issued while the user was an active member of an organization
    And an admin then disables that membership to free its seat
    When the CLI calls GET /api/auth/cli/personal-project with that token
    Then the response is 403
    And no personal team, project, or role binding is created
    And the presented access token is revoked

  @bdd @cli-onboarding @credentials @tenancy @integration
  Scenario: a deactivated user's token cannot mint or return a personal key
    Given a device-session token for a user whose account is deactivated
    When the CLI calls GET /api/auth/cli/personal-project with that token
    Then the response is 403
    And the presented access token is revoked

  @bdd @cli-onboarding @credentials @tenancy @integration
  Scenario: POST /api/auth/cli/project-key applies the same membership boundary
    Given a device-session token whose user is not an active member of the token's org
    When the CLI calls POST /api/auth/cli/project-key
    Then the response is 403 and no project key is returned
    And the presented access token is revoked

  @bdd @cli-onboarding @credentials @integration
  Scenario: the delivered personal key authenticates /api/me/usage
    Given the personal project key delivered by device login
    When GET /api/me/usage is called with that key
    Then the response is 200 with the caller's personal usage

  # ─────────────────────────────────────────────────────────────────────
  # The identity notice
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @notice @unit
  Scenario: device mode prints a one-line identity notice on stderr
    Given credentials resolved from the device session
    When the notice is printed
    Then stderr carries exactly one line:
      "Using your personal project (device login). Read another project: langwatch login --project"
    And nothing is printed to stdout

  @bdd @cli-onboarding @notice @unit
  Scenario: api-key mode names the project the key belongs to
    Given credentials resolved from LANGWATCH_API_KEY
    And the project name for that key is known
    When the notice is printed
    Then stderr carries exactly one line:
      "Using API key for project \"<name>\". Switch: langwatch login --project | --device"

  @bdd @cli-onboarding @notice @unit
  Scenario: the project name is fetched once and cached
    Given credentials resolved from LANGWATCH_API_KEY with no cached project name
    When the notice is printed
    Then the CLI fetches the project identity once
    And the name is cached keyed by a hash of the credential
    And a later run reads the cached name without a network call

  @bdd @cli-onboarding @notice @unit
  Scenario: the notice is yellow only when stderr is a TTY
    Given stderr is a TTY
    Then the notice line is styled yellow
    Given stderr is not a TTY
    Then the notice line is plain text with no escape sequences

  @bdd @cli-onboarding @notice @integration
  Scenario: -o json keeps stdout parseable while the notice goes to stderr
    Given a device session and `langwatch trace search -o json`
    When the command runs
    Then stdout is a single parseable JSON document
    And the identity notice appears on stderr only

  @bdd @cli-onboarding @notice @unit
  Scenario: the notice is suppressed for 30 minutes per credential and mode
    Given the notice was shown for a credential less than 30 minutes ago
    When another command resolves the same credential in the same mode
    Then no notice is printed
    And the suppression state lives in ~/.langwatch/notice-state.json keyed by a hash of the credential, never plaintext

  @bdd @cli-onboarding @notice @unit
  Scenario: switching modes re-triggers the notice despite suppression
    Given the device-mode notice was shown 5 minutes ago
    When the user exports LANGWATCH_API_KEY and runs another command
    Then the api-key mode notice is printed
    # Suppression applies per (credential, mode) pair, so a mode switch is
    # always announced.

  # ─────────────────────────────────────────────────────────────────────
  # Daemon discipline
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @credentials @daemon @unit
  Scenario: the resolved session key never touches the shared process env
    Given a device session resolves the personal project key
    When the resolver publishes it for the command's services to use
    Then process.env.LANGWATCH_API_KEY is NOT written
    And the key is published into a request-scoped credential holder instead
    # Writing the per-user key into the one shared process.env is the
    # cross-identity leak the daemon design forbids: concurrent device-mode
    # requests share a (cwd, env, colour) execution window, so a global write
    # by one is visible to another. The holder is established by AsyncLocalStorage
    # at each request boundary (cli/daemon/execution.ts + the in-process
    # dispatch), so a key set mid-command is visible to that request's own
    # services but never to a sibling request's.

  @bdd @cli-onboarding @credentials @daemon @unit
  Scenario: two interleaved requests each observe only their own credential
    Given two concurrent requests, each in its own credential holder
    And each resolves a different device-session key after an await boundary
    When each constructs its API client
    Then the first request's client authenticates only with the first key
    And the second request's client authenticates only with the second key
    And neither key is ever read from the shared environment

  # ─────────────────────────────────────────────────────────────────────
  # The missing-credentials error
  # ─────────────────────────────────────────────────────────────────────

  @bdd @cli-onboarding @error @unit
  Scenario: no login and no env var yields the not-logged-in error
    Given no device session and no LANGWATCH_API_KEY anywhere
    When any API-calling command resolves credentials
    Then the command exits 1
    And stderr explains, in order:
      """
      Error: you're not logged in, and LANGWATCH_API_KEY is not set.

      Sign in with your browser, interactively:
        langwatch login

      If you have an API key already, either of these works:
        langwatch login --api-key <key>
        echo 'LANGWATCH_API_KEY=<key>' >> .env

      Create an API key at <endpoint>/authorize

      For agents: don't reuse keys outside the project folder, check more options with `langwatch login --help` to help the user
      """
    And the authorize address shown is the server this CLI actually talks to, cloud or self-hosted, never a literal placeholder

  @bdd @cli-onboarding @error @unit
  Scenario: machine callers get the structured missing_api_key document with the same message
    Given no device session and no LANGWATCH_API_KEY anywhere
    When an API-calling command runs with -o json
    Then stdout carries a JSON error document with code "missing_api_key"
    And the message says the user is not logged in and names `langwatch login` first
    And meta.authUrl still points at <endpoint>/authorize
