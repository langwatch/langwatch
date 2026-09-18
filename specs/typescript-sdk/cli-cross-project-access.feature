Feature: CLI cross-project access with the user-scoped login key

  After `langwatch login`, the CLI holds a user-scoped API key whose reach the
  user selected on the authorize screen. Data commands keep defaulting to the
  personal project, and a `--project <id|slug>` flag points any trace command
  at another project the key can reach. `langwatch projects list` shows which
  projects those are.

  Pairs with:
    - specs/ai-governance/cli-onboarding/login-user-scoped-key.feature  (minting)
    - specs/typescript-sdk/cli-projects-api-keys.feature                (projects commands)

  Background:
    Given the user completed `langwatch login` against a server that mints
      user-scoped CLI keys
    And `~/.langwatch/config.json` holds the minted `cli_api_key`
    And no `LANGWATCH_API_KEY` is set in the environment or `.env`

  Rule: credential resolution prefers the user-scoped key for session logins

    @integration
    Scenario: data commands authenticate with the user-scoped key
      When the user runs `langwatch trace search`
      Then the request authenticates with the stored `cli_api_key`
      And targets the personal project, matching the pre-existing default

    @integration
    Scenario: explicit credentials still win over the session key
      Given `LANGWATCH_API_KEY` is set in the environment
      When the user runs `langwatch trace search`
      Then the request authenticates with `LANGWATCH_API_KEY`
      And the stored `cli_api_key` is not used

    @integration
    Scenario: a server without user-scoped keys falls back to the old behavior
      Given the exchange response carried no `cli_api_key`
      When the user runs `langwatch trace search`
      Then the request authenticates with the personal project's API key,
        exactly as before this feature

  Rule: --project selects the target project by id or slug

    @integration
    Scenario: trace search against another project by id
      Given the key reaches a project with id "proj-b"
      When the user runs `langwatch trace search --project proj-b`
      Then the search request is scoped to "proj-b"

    @integration
    Scenario: trace search against another project by slug
      Given the key reaches a project with slug "checkout-agent"
      When the user runs `langwatch trace search --project checkout-agent`
      Then the CLI resolves the slug through the project list
      And the search request is scoped to that project's id

    @integration
    Scenario: --project outside the key's reach fails with a clear message
      Given the key does not reach project "someone-elses"
      When the user runs `langwatch trace get abc123 --project someone-elses`
      Then the command exits non-zero
      And the error names the project and says the login key has no access to it

    @integration
    Scenario: --project with an unknown slug fails with a clear message
      When the user runs `langwatch trace search --project does-not-exist`
      Then the command exits non-zero
      And the error says no accessible project matches "does-not-exist"

  Rule: projects list shows the key's reach

    @integration
    Scenario: projects list shows every project the key can view
      Given the key is bound to the whole organization
      When the user runs `langwatch projects list`
      Then every project of the organization is listed with id and slug

    @integration
    Scenario: whoami summarises the login key's scope
      When the user runs `langwatch whoami`
      Then the output names the organization and states whether the login key
        covers the whole organization or a subset of projects

    @integration
    Scenario: whoami states the login key's permissions
      Given the login recorded the permission slugs the key was minted with
      When the user runs `langwatch whoami`
      Then the output lists those permission slugs, so a 403 on a command the
        key does not cover can be read off the login instead of discovered

    @integration
    Scenario: whoami stays silent about permissions the login never recorded
      Given the login predates the permissions field
      When the user runs `langwatch whoami`
      Then no permissions line is printed

  Rule: whoami -o json prints a secret-free machine-readable snapshot

    @e2e @unimplemented
    Scenario: A headless coding agent asks the CLI who the key belongs to
      Given a coding agent running headless with an API key
      When it asks the CLI who the key belongs to
      Then it gets the user and organization in a form it can parse

    @unit
    Scenario: whoami -o json prints one secret-free JSON object and exits 0
      Given the user is logged in
      When the user runs `langwatch whoami -o json`
      Then stdout is exactly one JSON object with user, organization,
        personal_project, cli_api_key_scope, gateway_url, and control_plane_url
      And a field present only when the config holds it is omitted otherwise
      And the object contains none of the keys api_key, cli_api_key, secret,
        default_personal_ingest_keys, or default_personal_vk
      And no string value in the object starts with "sk-lw-", "ik-lw-", or "pkey_"
      And the command exits 0

    @unit
    Scenario: whoami -o json when logged out emits a structured error and exits 1
      Given the user is not logged in
      When the user runs `langwatch whoami -o json`
      Then a structured error document is printed on stdout, not chalk prose
      And the existing "Not logged in" message is printed on stderr
      And the command exits 1

    @unit
    Scenario: whoami without a format flag keeps its existing human-readable output
      Given the user is logged in
      When the user runs `langwatch whoami`
      Then the existing human-readable lines are printed unchanged
      And the command exits 0

  Rule: A headless coding agent runs a query from the CLI

    @e2e @unimplemented
    Scenario: A headless coding agent runs a query from the CLI
      Given a coding agent running headless with an API key
      When it runs a query through the CLI
      Then it gets the rows in a form it can parse

    @unit
    Scenario: langwatch query -o json prints the rows and exits 0
      Given the user is logged in with a working API key
      When the user runs `langwatch query "SELECT 1" -o json`
      Then the query runs against the configured API key with no project header
      And stdout is exactly one JSON array of the returned rows
      And the command exits 0

    @unit
    Scenario: langwatch query prints a coded error and exits non-zero on failure
      Given the user is logged in with a working API key
      When the query is refused by the platform
      Then a structured error document naming the code, message, and meta is printed
      And the command exits non-zero

# --- AC Coverage Map ---
# AC12 "whoami -o json secret-free shape, exit 0" → Scenario: whoami -o json prints one secret-free JSON object and exits 0
# AC13 "whoami -o json when not logged in exits 1, structured error on stdout" → Scenario: whoami -o json when logged out emits a structured error and exits 1
# AC14 "whoami without a format flag unchanged, exits 0" → Scenario: whoami without a format flag keeps its existing human-readable output
