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
