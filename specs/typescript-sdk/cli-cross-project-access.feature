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

  Rule: every command that runs against a project takes --project

    The flag was added one family at a time, so `instant-eval` shipped without
    it and a customer holding an organization login had no way to point the
    whole family at a project. The option is therefore declared from one place
    over the built command tree, and the commands that do NOT run inside a
    project are named in a list with a reason each. A new command inherits the
    flag; leaving it out is a deliberate entry, not an oversight.

    @unit
    Scenario: a command that resolves project credentials accepts --project
      Given the command tree the CLI runs
      When every command that authenticates against a project is listed
      Then each one declares --project

    @unit
    Scenario: a command that never runs inside a project does not take --project
      Given `langwatch config get`, which reads a local file
      When the command tree is built
      Then it declares no --project
      And the list that exempts it records why

    @unit
    Scenario: the flag reaches the credential resolver without the command passing it
      Given a command whose implementation calls no project argument of its own
      When the user runs it with `--project checkout-agent`
      Then the resolver receives "checkout-agent" as the project selector

    @unit
    Scenario: a command with its own --project keeps its own meaning
      Given `langwatch login --project <slug>`, which writes that project's key to .env
      When the user runs it
      Then the value is not read as the credential scope for the login itself

    @unit
    Scenario: a management command keeps the credential where the resource lives
      Given `langwatch gateway-budgets list`, and the three commands that act
        on a budget id
      When the command tree is built
      Then none of them declares --project
      And the list that exempts them records that they answer for the
        organization

    @unit
    Scenario: the whole instant-eval family takes the flag
      Given the command tree the CLI runs
      When the instant-eval commands are listed
      Then every one of them declares --project
      And every one of them is marked as running inside a project

  Rule: a project the credential cannot be pointed at is said so, not dropped

    LANGWATCH_PROJECT_ID was read and then ignored: a request carrying a legacy
    project key takes its project from the key, so the variable changed nothing
    and an id that matched no project answered with another project's rows.
    Nothing on screen said which project had answered.

    @unit
    Scenario: LANGWATCH_PROJECT_ID reaches the request for a user-scoped key
      Given the credential is a user-scoped key
      And LANGWATCH_PROJECT_ID names a project id
      When the user runs a command that reads from a project
      Then the id reaches the request unresolved, as a personal access token
        has always needed
      And no project listing is fetched to check it first

    @unit
    Scenario: --project wins over LANGWATCH_PROJECT_ID
      Given LANGWATCH_PROJECT_ID names one project
      When the user runs a command with --project naming another
      Then the request is scoped to the one the flag names

    @unit
    Scenario: a named project that matches nothing is refused before the request
      Given the credential is a user-scoped key
      When the user runs a command with --project naming a project that does not exist
      Then the command exits non-zero
      And the error names the project and says nothing accessible matches it

    @unit
    Scenario: --project against a key bound to one project is refused
      Given LANGWATCH_API_KEY is a project key, which carries its own project
      When the user runs a command with --project naming another project
      Then the command exits non-zero
      And the error says the key is bound to its own project and names logging
        in as the way to reach another

    @unit
    Scenario: a stale LANGWATCH_PROJECT_ID beside a project key warns rather than fails
      Given LANGWATCH_API_KEY is a project key
      And LANGWATCH_PROJECT_ID is set from an earlier session
      When the user runs a command that reads from a project
      Then the command runs against the key's own project
      And a warning on stderr says the variable was ignored and why

    @unit
    Scenario: every request warns that LANGWATCH_PROJECT_ID was ignored
      Given the CLI daemon serves several commands from one process
      And each of them carries a project key and LANGWATCH_PROJECT_ID
      When the commands run one after another
      Then every one of them prints the warning
      And a single command prints it once however often its credential resolves

    @unit
    Scenario: a project key given by flag is not blamed on the environment
      Given the user passes a project key with --api-key
      When they run a command with --project naming another project
      Then the command exits non-zero
      And the refusal names --api-key as the credential in hand
      And it does not tell them to unset an environment variable they never set

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
