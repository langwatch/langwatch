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
    Scenario: The legacy key is listed and can only be revoked
      When "ada" opens the API keys of project "alpha"
      Then a row "Project key (legacy)" shows its masked hint, created and last used
      And its row menu offers "Revoke" and nothing else

    @integration
    Scenario: A revoked legacy key is refused
      Given "ada" revoked the legacy key of project "alpha"
      When a trace is sent with that key
      Then the answer is 401
      And no other key of project "alpha" is affected

    @integration
    Scenario: A banner urges replacing the legacy key by the deadline
      Given project "alpha" still has a live legacy key
      When "ada" opens the API keys of project "alpha"
      Then a banner asks her to create a new key and revoke the legacy one before 31 March 2027
      And the banner is gone once the legacy key is revoked

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

  Rule: nobody mints a key beyond what they hold, and a key expires unless told otherwise

    @integration
    Scenario: A new key expires in 90 days unless "never" is chosen
      When "ada" mints a key without changing the expiry
      Then the key expires 90 days from now
      And when she chooses "never" the key has no expiry

    @integration
    Scenario: A key row offers Revoke and nothing else
      When "ada" opens the row menu of any key
      Then the only action is "Revoke"

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
    Scenario: The mint dialog greys out roles beyond the reader
      When "vic" opens "Create a key" on project "alpha"
      Then the Admin and Member roles are shown but cannot be chosen

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

  Rule: every screen that showed the project key offers "Create a key" instead

    @integration
    Scenario Outline: A setup screen mints instead of revealing
      When "ada" opens <screen> for project "alpha"
      Then no key is on the page
      And "Create a key" opens the mint drawer with project "alpha" chosen

      Examples:
        | screen                              |
        | the onboarding API card             |
        | the traces integrate drawer         |
        | the prompt API snippet dialog       |
        | the workflow publish dialog         |
        | the personal workspace setup        |
        | the project home agent pill         |

    @integration
    Scenario: The secret panel shows the token once with ready-to-copy snippets
      Given "ada" minted a key from the mint drawer
      Then the panel shows the token in a highlighted snippet for .env, Python, TypeScript, curl and OTLP headers
      And each snippet has a copy button that says "Copied" after a copy
      And "Done" stays disabled until "I've stored this key" is ticked

    @integration
    Scenario: Closing the secret panel early asks first
      Given the secret panel is open and "I've stored this key" is not ticked
      When "ada" closes the drawer
      Then she is asked to confirm that the key will not be shown again

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
      Then the audit log has "api-key.created" and "api-key.revoked" entries naming the key id and the actor
      And neither entry carries the token

    @unit
    Scenario: Last used is written at most once a minute per key per process
      Given a key used 100 times within one minute
      Then its last-used time is written once
