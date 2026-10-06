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
      And the answer carries the key's id, name, masked hint, grants, created and expiry

    @integration
    Scenario: No read after the mint carries the token
      Given "ada" minted a key "ci" and kept its token
      When the key is read through the tRPC list, the REST list, the REST get and the organization graph
      Then no response body contains the token or its secret half
      And each response shows only the masked hint "sk-lw-<first five of the lookup id>..."

    @integration
    Scenario: No project read carries a project key or the LangWatchQL key
      Given project "alpha" has a legacy project key
      When "max" reads the organization graph, the teams with their projects, and project "alpha"
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

  Rule: a legacy project key keeps working until it is revoked, and nobody can find it

    @integration
    Scenario: A legacy project key still authenticates after the backfill
      Given project "alpha" had the legacy key "sk-lw-<48 characters>" before the backfill
      When the backfill runs
      And a trace is sent with that key in X-Auth-Token
      Then the trace is accepted for project "alpha"
      And the key's last-used time moves forward

    @unit
    Scenario: The backfill stores no plaintext and is safe to run twice
      Given two projects with legacy keys
      When the backfill runs twice
      Then each project has exactly one legacy key row
      And the row holds a hash of the key and a masked hint, never the key itself

    @integration
    Scenario: The legacy key is not listed on the keys page
      When "ada" opens the API keys of project "alpha"
      Then no row shows the legacy project key
      And no control copies or rotates it

    @integration
    Scenario: A revoked legacy key is refused
      Given "ada" revoked the legacy key of project "alpha"
      When a trace is sent with that key
      Then the answer is 401
      And no other key of project "alpha" is affected

    @integration
    Scenario: A banner tells an admin that legacy project keys are going away
      Given project "alpha" still has a live legacy key
      When "ada" opens the API keys of project "alpha"
      Then a warning banner titled "Legacy project keys are going away" says to use personal access tokens instead
      And the banner offers no action

    @integration
    Scenario: A reader who cannot manage the project sees no banner and no error
      Given project "alpha" still has a live legacy key
      When "max" opens the API keys of project "alpha"
      Then the legacy key status is not read
      And no banner and no error is shown

    @unimplemented
    Scenario: The banner offers to revoke the project key
      Given project "alpha" still has a live legacy key
      When "ada" opens the API keys of project "alpha"
      Then the banner says that once revoked the key stops working for good and cannot be restored
      And the banner offers "Revoke project key..."

    @unimplemented
    Scenario: Revoking the project key takes two confirmations
      Given "ada" chose "Revoke project key..."
      Then a dialog "Revoke the project key?" offers Cancel and Continue
      When she chooses Continue
      Then a second step asks her to type the project name to confirm
      And "Revoke for good" stays disabled until she types the project name exactly

    @unimplemented
    Scenario: A name that does not match keeps the revoke disabled
      Given "ada" is on the second step of revoking the project key of "alpha"
      When she types "alph"
      Then "Revoke for good" is disabled

    @unimplemented
    Scenario: A revoked project key hides the banner
      Given "ada" typed the exact project name on the second step
      When she chooses "Revoke for good"
      Then a toast says "Project key revoked"
      And the banner is gone

    @unit
    Scenario: A new project gets no customer-facing project key
      When "ada" creates project "gamma"
      Then no project key row is listed for project "gamma"
      And the setup screens offer "Create a key" instead

    # Until ADR-166 exists, internal callers read Project.apiKey. These two hold that seam.
    @integration
    Scenario: Internal callers keep working while the legacy key is hidden
      Given project "alpha" has a legacy key that no screen or response shows
      When a scenario run, a workflow code block and the gateway's trace export run for project "alpha"
      Then each authenticates as project "alpha"

    @integration
    Scenario: Revoking the legacy key does not stop internal callers
      Given "ada" revoked the legacy key of project "alpha"
      When a scenario run for project "alpha" sends its traces
      Then the traces are accepted
      And the revoked key itself is still refused

  Rule: a revoked or expired key is refused everywhere, within the cache bound

    @integration
    Scenario Outline: A revoked key is refused at every door
      Given "ada" minted a key and then revoked it
      When the key is presented at <door>
      Then the request is refused with 401

      Examples:
        | door                          |
        | the OTLP traces endpoint      |
        | the collector                 |
        | the REST management API       |
        | the hosted MCP endpoint       |

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

    @unit
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
      Then the key is refused on project "alpha" within the cache bound

    @integration
    Scenario: The mint drawer offers no role chooser
      When "vic" opens "Create a key" on project "alpha"
      Then no role can be chosen
      And the key is minted with the role of "vic"'s own binding

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
    Scenario: A CLI project login writes a freshly minted key
      Given "ada" approves a "project_api_key" device login for project "alpha"
      When the CLI exchanges the device code
      Then the answer's "api_key" is a new key scoped to project "alpha"
      And the device record never held a key
      And the legacy project key is unchanged

    @unit
    Scenario: A second CLI login from the same device replaces the first key
      Given a CLI project key minted for device "laptop" and project "alpha"
      When the same device logs in to project "alpha" again
      Then the older key is revoked with cause "rotation"
      And a key for another device is untouched

    @integration
    Scenario: A hosted MCP authorization seals a dedicated key
      When "ada" authorizes an MCP client for project "alpha"
      Then the MCP session holds a key minted for that client
      And revoking that key ends the MCP session

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
