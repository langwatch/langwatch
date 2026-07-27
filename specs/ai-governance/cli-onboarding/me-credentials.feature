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
    And LANGWATCH_API_KEY is not set anywhere
    When any API-calling command resolves credentials
    Then the resolved API key is the personal project's key
    And the resolved mode is device session

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
  Scenario: GET /api/auth/cli/personal-project ensures the personal workspace
    Given a valid device-session bearer token for a user with no personal workspace yet
    When the CLI calls GET /api/auth/cli/personal-project
    Then the personal workspace is created
    And the response carries the personal project's id, slug, name and api_key

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
  Scenario: a credential materialised into the environment is never trusted as caller input
    Given a previous request resolved a device session and materialised the key into process.env
    When a later request resolves credentials in the same process
    Then the resolver re-reads ~/.langwatch/config.json from disk
    And a logout between the two requests makes the later request fail with the not-logged-in error
    # The daemon serves many requests from one process. Auth is resolved per
    # request from disk (see cli/daemon/identity.ts); the resolver tracks the
    # value it materialised and refuses to read it back as if the caller set it.

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
      Error: not logged in and LANGWATCH_API_KEY is not set.
      Easiest: langwatch login          (browser sign-in, no key needed)
      With a key: langwatch login --api-key <key>   or   echo 'LANGWATCH_API_KEY=<key>' >> .env
      Keys live at: <endpoint>/authorize
      """

  @bdd @cli-onboarding @error @unit
  Scenario: machine callers get the structured missing_api_key document with the same message
    Given no device session and no LANGWATCH_API_KEY anywhere
    When an API-calling command runs with -o json
    Then stdout carries a JSON error document with code "missing_api_key"
    And the message says the user is not logged in and names `langwatch login` first
    And meta.authUrl still points at <endpoint>/authorize
