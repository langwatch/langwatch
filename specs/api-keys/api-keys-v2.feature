Feature: API keys v2 - the secret is shown once, and a project key is minted, never revealed
  # Ruled (Alex, 2026-09-30): modules/api-key/adrs/002-project-keys-are-hidden.md
  # Plan: .claude/tmp/review/ak0-api-keys-plan.md. Supersedes project-key-read-access and project-key-rotation.
  # Vocabulary: grants and roles. The REST wire field `roleBindings` stays as main publishes it.

  Background:
    Given an organization "acme" with a team "core" and projects "alpha" and "beta"
    And "ada" is an organization admin of "acme"
    And "max" holds the Member role on project "alpha" only
    And "vic" holds the Viewer role on project "alpha" only

  Rule: a secret leaves the server exactly once, in the answer to the mint

    @integration
    Scenario: Minting a key answers its token once
      When "ada" mints a service key "ci" on project "alpha"
      Then the answer carries a token starting with "sk-lw-"
      And the answer carries the key's identity beside it: its id, name and creation time

    @integration
    Scenario: No read after the mint carries the token
      Given "ada" minted a key "ci" and kept its token
      When the key is read through the tRPC list, the REST list and the REST get
      Then no response body contains the token or its secret half

    # Gap: no masked hint exists on the key row; main carried none either.
    @integration @unimplemented
    Scenario: A key is shown by a masked hint of its lookup id
      Given "ada" minted a key "ci" and kept its token
      When the key is read through the tRPC list, the REST list, the REST get and the organization graph
      Then each response shows only the masked hint "sk-lw-<first five of the lookup id>..."

    @integration
    Scenario: No project read carries a project key or the LangWatchQL key
      Given project "alpha" has a legacy project key
      When "max" reads the organizations payload, with its teams and their projects
      Then no response body contains the legacy key, the LangWatchQL key or the storage secret
      And the same holds for "ada"

    @integration
    Scenario: The procedures that revealed or rotated the project key are gone
      When a signed-in project admin calls "project.getProjectAPIKey" or "project.regenerateApiKey"
      Then the call fails as a procedure that does not exist

    @integration
    Scenario: The REST project-key routes stay refused
      When any API key calls GET "/api/projects/alpha/api-key" or POST "/api/projects/alpha/regenerate-api-key"
      Then the answer is 403, as on main
      And no key is revealed or rotated

  Rule: a legacy project key keeps working until it is revoked, and no page reveals it
    # Beyond ingestion it works only while its project is on the full-access
    # allowlist (modules/auth/specs/legacy-project-key-scope.feature).

    @integration
    Scenario: A legacy project key still authenticates
      Given project "alpha" holds the legacy key "sk-lw-<48 characters>" on the project itself
      When a trace is sent with that key in X-Auth-Token
      Then the key resolves to project "alpha"

    # Alex 2026-10-09: keys created on main keep main's access, while their project is on the allowlist.
    @unit
    Scenario: A legacy project key on the full-access allowlist reads its own project's traces
      Given project "alpha" holds the legacy key "sk-lw-<48 characters>" on the project itself
      When a trace search is sent with that key
      Then the traces of project "alpha" are read on an own-only proof
      And a request naming another project still reads only project "alpha"

    @unit
    Scenario: An API key with no owner reads its own project's traces
      Given an API key created on main for project "alpha" with no owner
      When a trace search is sent with that key
      Then the traces of project "alpha" are read on an own-only proof
      And the same key naming another project is refused

    @unit
    Scenario: A run nobody started is refused a trace read cleanly
      Given the key of a run nobody started, for project "alpha"
      When a trace search is sent with that key
      Then the answer is 403 "permission_denied"


    # Alex 2026-10-06: never built. The legacy key still lives on Project.apiKey; no ApiKey row is backfilled.
    @unit @unimplemented
    Scenario: The backfill stores no plaintext and is safe to run twice
      Given two projects with legacy keys
      When the backfill runs twice
      Then each project has exactly one legacy key row
      And the row holds a hash of the key and a masked hint, never the key itself

    @integration
    Scenario: The legacy key is listed as a row an admin can revoke
      Given project "alpha" still has a live legacy key
      When "ada" opens the API keys of project "alpha"
      Then a row "Project key" with a "Legacy" badge is listed, scoped to project "alpha"
      And it shows when the key was last used
      And its only action is Revoke
      And no control copies it or hands out a new legacy key

    @integration
    Scenario: A banner tells an admin that legacy project keys are going away
      Given project "alpha" still has a live legacy key
      When "ada" opens the API keys of project "alpha"
      Then a warning banner titled "Legacy project keys are going away" says to use personal access tokens instead
      And it offers "Revoke and replace"
      And it stays until the legacy key is revoked

    @integration
    Scenario: Every project in the organisation with a live legacy key gets its own row
      Given project "alpha" and project "beta" both still have a live legacy key
      When "ada" opens the API keys
      Then a "Project key" row is listed for project "alpha" and one for project "beta"
      And each row is scoped to its own project and carries its own Revoke

    @integration
    Scenario: The banner names every live project without a bulk revoke action
      Given project "alpha" and project "beta" both still have a live legacy key
      When "ada" opens the API keys
      Then the warning banner names both projects
      And the banner offers no "Revoke and replace" action

    @integration
    Scenario: Same-named projects remain distinguishable before revoking a legacy key
      Given two projects named "Web App" have different slugs and live legacy keys
      When "ada" opens the API keys and chooses Revoke for the second project
      Then the rows, action labels and confirmation identify the projects by slug
      And confirming revokes only the second project's legacy key

    @integration
    Scenario: A replacement key's snippets name the replaced project
      Given the remembered project is "alpha" and project "beta" has a live legacy key
      When a reader revokes and replaces the key of project "beta"
      Then both service and personal replacement keys are scoped to project "beta"
      And the setup snippets use project "beta"

    @integration
    Scenario: Legacy key loading does not show an empty key list
      Given the API key list is empty and the legacy key read has not answered
      When "ada" opens the API keys
      Then the table shows loading rows
      And neither an empty list nor a no-matches message is shown

    @integration
    Scenario: Revoking one project's legacy key leaves the other project's row and the banner
      Given project "alpha" and project "beta" both still have a live legacy key
      And "ada" revoked the legacy key of project "alpha"
      When "ada" opens the API keys
      Then no "Project key" row is listed for project "alpha"
      And a "Project key" row is listed for project "beta"
      And the warning banner is still shown

    @integration
    Scenario: The banner goes once no project in the organisation holds a live legacy key
      Given project "alpha" and project "beta" both still have a live legacy key
      And "ada" revoked the legacy key of both projects
      When "ada" opens the API keys
      Then no "Project key" row is listed
      And no warning banner is shown

    @unit
    Scenario: A reader only sees the legacy rows of the projects they can manage
      Given project "alpha" and project "beta" both still have a live legacy key
      And "pat" administers project "beta" only
      When "pat" requests the organisation's legacy keys
      Then only project "beta" is returned

    @integration
    Scenario: The banner's button revokes and replaces the legacy key
      Given project "alpha" still has a live legacy key
      When "ada" clicks "Revoke and replace" on the banner
      Then the same confirmation as the legacy row's Revoke opens

    @integration
    Scenario: The legacy key status answers when the key was last used
      Given the legacy key of project "alpha" authenticated a request
      When the legacy key status of project "alpha" is read
      Then it answers present with the time of that use
      And once the key is revoked it answers absent with no time

    @integration
    Scenario: A revoked legacy key is refused
      Given "ada" revoked the legacy key of project "alpha"
      Then the project's stored key is replaced by a value that never authenticates
      And a trace sent with the old key is refused

    @unit
    Scenario: A reader who manages no project receives no legacy keys
      Given project "alpha" and project "beta" both still have a live legacy key
      When "max" requests the organisation's legacy keys
      Then no legacy keys are returned

    @integration
    Scenario: A project that never had a legacy key shows no legacy row
      Given project "gamma" was created after project keys were retired, so it never had a legacy key
      When "ada" opens the API keys of project "gamma"
      Then the legacy key status answers absent
      And no legacy row is shown

    @integration
    Scenario: Revoking the legacy key says an API key takes its place
      Given "ada" chose Revoke on the legacy key row of project "alpha"
      Then a dialog "Revoke the legacy project key?" says the key stops working within seconds
      And it says they next create a new API key for project "alpha", shown once

    @integration
    Scenario: Revoke waits until the reader's roles are known
      Given "ada" chose Revoke on the legacy key row of project "alpha"
      And the page has not yet read their roles
      Then the dialog's Revoke is unavailable

    @integration
    Scenario: Revoke says so when the reader's roles could not be read
      Given "ada" chose Revoke on the legacy key row of project "alpha"
      And the page could not read their roles
      Then the dialog's Revoke is unavailable and says their access could not be checked

    @integration
    Scenario: Confirming the legacy key revoke revokes it and opens the create drawer filled in
      Given "ada" chose Revoke on the legacy key row of project "alpha"
      When they confirm
      Then the legacy key of project "alpha" is revoked
      And a toast says "Legacy project key revoked"
      And the legacy key row and the banner are gone
      And the create drawer opens with the name "Project API Key", full access to project "alpha" and no expiry
      And the drawer warns that the legacy key no longer works and the project may have no working key until one is created
      And no API key is created yet

    @integration
    Scenario: Revoking the legacy key swaps it for an API key
      Given "ada" confirmed Revoke on the legacy key row of project "alpha"
      When they create the key from the drawer
      Then a service API key "Project API Key" is created with full access to project "alpha" and no expiry
      And its token is shown once

    @integration
    Scenario: A failed revoke keeps the legacy key and opens no drawer
      Given "ada" chose Revoke on the legacy key row of project "alpha"
      When they confirm and the revoke fails
      Then an error says the legacy key could not be revoked
      And the legacy key row stays and no drawer opens
      And the confirm stays open so they can try again

    @integration
    Scenario: A failed create after the revoke keeps the drawer open
      Given "ada" confirmed Revoke on the legacy key row of project "alpha"
      When the new API key cannot be created from the drawer
      Then an error says the key could not be created
      And the drawer stays open so they can try again

    @integration
    Scenario: A project admin's swap gets a personal key with their role
      Given "pat" administers the team that owns project "alpha" but not the organization
      When "pat" confirms Revoke on the legacy key row of project "alpha" and creates the key from the drawer
      Then the legacy key of project "alpha" is revoked
      And a personal API key with the Admin role on project "alpha" is created

    @integration
    Scenario: A swap whose new key could not send traces keeps the legacy key
      Given a reader who can manage project "alpha" holds no role on it that sends traces
      When they confirm Revoke on the legacy key row of project "alpha"
      Then the create drawer does not open and no API key is created
      And the legacy key of project "alpha" is not revoked
      And an error says their role cannot create a key that sends traces

    @unit
    Scenario: A new project gets no customer-facing project key
      When "ada" creates project "gamma"
      Then project "gamma" stores a legacy key value that never authenticates
      And its legacy key status answers absent, so no project key row is listed

    @unit
    Scenario: No internal caller reads the legacy key
      Given the legacy key of project "alpha" is revoked
      When a scenario run, a workflow code block and the gateway's trace export run for project "alpha"
      Then each authenticates with a key minted for that run or export
      And none of them reads the project's legacy key

    @unit
    Scenario: Revoking the legacy key stops nothing the platform runs
      Given "ada" revoked the legacy key of project "alpha"
      When a scenario run for project "alpha" sends its traces
      Then it authenticates with the run's own minted key
      And the revoked key itself is still refused

  Rule: a revoked or expired key is refused everywhere, within the cache bound

    @integration
    Scenario: A revoked key is refused at every door
      Given "ada" minted a key and then revoked it
      When the key is presented to token resolution, which every door asks
      Then the key does not resolve and the door answers 401

    @unit
    Scenario: A revoke made on another process reaches this one within five seconds
      Given this process verified a key a moment ago
      When the key is revoked by another process
      Then this process refuses the key no later than five seconds after the revoke

    @unit
    Scenario: An expired key is refused at its moment, not at the cache bound
      Given a key that expires in two seconds was verified just now
      When three seconds pass
      Then the key is refused

    # Alex 2026-10-06: never built. A revoked key resolves to nothing, so every refusal is the plain invalid-key answer.
    @unit @unimplemented
    Scenario: A revoked key's refusal names the revocation only to its holder
      Given a revoked key
      When it is presented with its correct secret
      Then the 401 says the key was revoked
      And when it is presented with a wrong secret the 401 is the plain invalid-key answer

  Rule: nobody mints a key beyond what they hold, and the minter chooses when it expires

    @integration
    Scenario: Create stays unavailable until an expiry is chosen
      Given "ada" has named a new key and has not chosen an expiry
      Then the expiry field asks her to choose one
      And Create is unavailable
      And when she chooses an expiry Create becomes available

    @integration
    Scenario: The authorize page mints nothing until an expiry is chosen
      Given "ada" opens the authorize page for a CLI or MCP setup
      Then it offers the same expiry choices as the create drawer, "No expiration" included
      And no choice is preselected
      And the mint stays unavailable until she chooses one

    @integration
    Scenario: Choosing no expiration mints a key with no expiry
      When "ada" names a new key and chooses "No expiration"
      Then the key is minted with no expiry

    @integration
    Scenario: Choosing a preset mints a key that expires that many days from now
      When "ada" names a new key and chooses "30 days"
      Then the key expires 30 days from now

    @integration
    Scenario: A key row offers Edit and Revoke
      When "ada" opens the row menu of a key she may change
      Then its actions are "Edit" and "Revoke", and nothing else

    @integration
    Scenario: A member mints a personal key within their own grants
      When "max" mints a personal key with the Member role on project "alpha"
      Then the key is minted

    @integration
    Scenario: A member cannot mint a key on a project they do not hold
      When "max" mints a personal key on project "beta"
      Then the mint is refused with 403
      And no key row is written

    @integration
    Scenario: A member cannot mint a key with a role above their own
      When "vic" mints a personal key with the Admin role on project "alpha"
      Then the mint is refused with 403 naming the permissions beyond the caller
      And no key row is written

    @integration
    Scenario: Only an organization admin mints a service key
      When "max" mints a service key on project "alpha"
      Then the mint is refused with 403

    @integration
    Scenario: A key never exceeds its owner after the owner loses a grant
      Given "max" minted a personal key with the Member role on project "alpha"
      When "max" loses his grant on project "alpha"
      Then the key is refused on project "alpha" at its next permission check

    @integration
    Scenario: The mint drawer offers no role chooser
      When "vic" opens "Create a key" on project "alpha"
      Then no role can be chosen
      And the key is minted with the role of "vic"'s own binding

    @integration
    Scenario: Every unmet requirement of a new key is named and the first is focused
      Given "ada" submits the create drawer with no name, no scope, Restricted with no permission and no expiry
      Then each of those fields shows its own error
      And focus moves to the first of them
      And no key is minted
      And what she entered is kept when she fixes one field and submits again

    @integration
    Scenario: A failed read of the caller's access can be retried from the drawer
      Given the read of "ada"'s access failed
      Then Create is unavailable and says why
      And Retry reads it again without closing the drawer or losing what she typed

  Rule: a key in another organization does not exist for the caller

    @integration
    Scenario Outline: A key id from another organization answers 404
      Given a key minted in organization "globex"
      When "ada" calls <operation> with that key's id
      Then the answer is 404 "api_key_not_found"
      And the key in "globex" is unchanged

      Examples:
        | operation                 |
        | GET /api/api-keys/{id}    |
        | PATCH /api/api-keys/{id}  |
        | DELETE /api/api-keys/{id} |
        | apiKey.revoke             |

  Rule: every screen that showed the project key offers a personal access token instead

    @integration
    Scenario Outline: Integrating a project offers a personal access token, shown once
      When "ada" opens <screen> for project "alpha"
      Then no key is on the page and the snippets show "<YOUR_LANGWATCH_API_KEY>"
      When she chooses "Create a personal access token"
      Then a personal key on project "alpha" is minted holding only <permissions>
      And the screen says the token <can do> in this project and nothing else
      And the token is shown once and fills the snippets while the screen is open
      And the token is held in memory only, never in a store, local storage or the query cache
      And the token is dropped when the project, organization or signed-in user changes

      Examples:
        | screen                        | permissions                                     | can do                         |
        | the onboarding API card       | traces:create, as a CLI "login --project" key   | can only send data             |
        | the personal workspace setup  | traces:create                                   | can only send data             |
        | the traces integrate drawer   | traces:create                                   | can only send data             |
        | the traces MCP config         | the project read grants only                    | can read this project's data   |
        | the onboarding MCP config     | the project read grants only                    | can read this project's data   |
        | the prompt API dialog         | prompts:view                                    | can read prompts               |
        | the evaluator API integration | evaluations:manage                              | can manage evaluations         |
        | the workflow publish dialog   | workflows:manage                                | can manage workflows           |

    @integration
    Scenario: A token holding more than the reader may grant is refused
      Given "max" cannot view prompts in project "alpha"
      When "max" chooses "Create a personal access token" in the prompt API dialog
      Then the mint is refused with "api_key_scope_violation"
      And the refusal is shown and no token is

    @unimplemented
    Scenario Outline: A refused setup token says what is missing and how to carry on
      Given "max" cannot read the data of project "alpha"
      When "max" chooses "Create a personal access token" in <screen>
      Then the mint is refused with "api_key_scope_violation"
      And the screen says "You need read access to this project's data to create a setup token"
      And the screen points to an admin, or to an ingestion-only token from Settings
      And no token is shown

      Examples:
        | screen                      |
        | the traces integrate pane   |
        | the traces integrate drawer |
        | the onboarding API card     |
        | the onboarding product setup |

    @integration
    Scenario: The authorize page mints a personal access token
      When "ada" opens "/authorize" and chooses "Create and copy a personal access token"
      Then a personal key for her active project is minted and its token copied
      And no project key is read

    @integration
    Scenario: The secret panel shows the token once with ready-to-copy snippets
      Given "ada" minted a key from the mint drawer
      Then the "Token Created" panel shows the token in highlighted .env, Bearer and Basic Auth snippets
      And a tab for each coding assistant carries its own command
      And each snippet's copy button copies the real token even while it is masked

    @integration
    Scenario: Closing the secret panel needs no confirmation
      Given the "Token Created" panel is open
      When "ada" closes it
      Then it closes at once, with no checkbox or confirmation gating it
      And the panel warned her beforehand to copy the token now

  Rule: a setup token holds the least its screen needs (Alex, 2026-10-01)

    @integration
    Scenario: A coding-agent setup mints its MCP token with project reads only, apart from the ingestion token
      When "ada" creates a token on the onboarding manual setup for project "alpha"
      Then that token holds only traces:create
      When she creates a token on the coding-agent setup's MCP tab
      Then a second token on project "alpha" is minted holding only the project read grants
      And the MCP config is filled with that second token, never the ingestion one

    @integration
    Scenario: The traces integrate drawer mints an ingestion token for .env and a reads token for MCP
      When "ada" opens the traces integrate drawer for project "alpha"
      Then the env block's token holds only traces:create
      And the MCP config's token holds only the project read grants

    @integration
    Scenario: The traces integrate pane mints only an ingestion token
      When "ada" opens the traces integrate pane for project "alpha"
      Then the token it mints holds only traces:create

    @unimplemented
    Scenario: A setup skill that creates something gets its own token holding exactly that create permission
      When "ada" sets up a skill that creates scenarios in project "alpha"
      Then a token for that skill alone is minted holding only the create permission it calls
      And the skill is handed no other setup token

    @unit
    Scenario: The authorize page mints the device-flow default set, capped at what the person holds
      Given "max" holds only some of the device-flow default permissions on project "alpha"
      When "max" opens "/authorize" and creates a personal access token
      Then the token holds the device-flow defaults that "max" holds, and no others
      And no token with every permission ("permissionMode: all") is minted

  Rule: the CLI and MCP flows mint a key rather than hand out the project key

    @integration
    Scenario: A CLI project login answers a session, never a minted key
      Given "ada" approves a "project_api_key" device login for project "alpha"
      When the CLI exchanges the device code
      Then the answer is a project-locked session with an access token and a refresh token
      And the answer carries no "api_key" and no legacy project key

    @unit
    Scenario: A second CLI login from the same device replaces the first key
      Given a CLI project key minted for device "laptop" and project "alpha"
      When the same device logs in to project "alpha" again
      Then the older key is revoked with cause "rotation"
      And a key for another device is untouched

    @integration
    Scenario: A hosted MCP authorization yields a person-bound session, never a project key
      When "ada" authorizes an MCP client for project "alpha" and the client exchanges its code
      Then the answer is an access token bound to "ada" and project "alpha", with a refresh token
      And once her grant is revoked the MCP call is refused with "mcp_grant_revoked"

  Rule: keys are audited and their use is recorded without a write per call

    @integration
    Scenario: Minting and revoking are audited
      When "ada" mints and then revokes a key
      Then the audit log has an "apiKey.create" entry naming the actor, the key's name and its type
      And an "apiKey.revoke" entry naming the actor and the key id
      And neither entry carries the token

    @unit
    Scenario: Last used is written at most once a minute per key per process
      Given a key used 100 times within one minute
      Then its last-used time is written once
      And a use after the minute writes it again
      And a write that fails lets the next use try again
