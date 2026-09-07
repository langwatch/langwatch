Feature: AI Gateway Governance — Ingest API Key Lifecycle
  As a user wiring an upstream tool's OTLP export into a LangWatch project
  I want a write-only "ingestion key" that is just an API key scoped to one
  project with an ingest-only role, issued / rotated / revoked through the
  one API-key primitive
  So that the credential I spray into an agent's environment can only write
  traces into that one project and nothing else, with no second credential
  type to learn or migrate

  Why a personal key belongs to a CLI session:
    A person runs one tool from a laptop, a desktop and a few cloud machines
    under one login. Each machine signs in with `langwatch login`, which mints
    a CLI login key for that session, and each machine's ingest key is minted
    under that login key (`parentApiKeyId`). The ingest key then lives and
    dies with the session: logout, a revoke from the devices tab, a re-login
    from the same device and session expiry all retire the login key, and
    every ingest key parented to it goes with it. Nothing else revokes a
    machine's key on its behalf, so no mint can break another machine.

  Why one primitive (replaces the retired UserIngestionBinding):
    There is ONE credential primitive: ApiKey (HMAC-SHA256 + pepper, split
    `{prefix}{lookupId}_{secret}` format). An "ingestion key" is an ApiKey with
    `ingestSourceType` set plus a single project-scoped RoleBinding granting
    the system "Ingest Only" role (permissions = ["traces:create"] only). Ingest
    keys carry an `ik-lw-` prefix (vs full-access `sk-lw-`) purely for
    identifiability; resolution is identical (lookup by lookupId). The retired
    UserIngestionBinding primitive — a separate `ik-lw-` token with its own
    plain-SHA256 hash and resolver branch — is GONE.

  Why ingest-only is genuinely write-only:
    `traces:create` gates exactly the three trace-WRITE endpoints (the OTLP
    receiver, the SDK collector, DSPy/experiment trace writes). Reads use
    `traces:view`, deletes use `traces:delete`. A role granting only
    `traces:create` therefore cannot read, query, delete, or manage anything.

  Uniform across project types:
    The ingest key is project-scoped via its RoleBinding, so it works the same
    for a personal project AND a team project. Nothing about it is
    personal-only (unlike the retired binding).

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has a personal project "personal-jane"
    And the system "Ingest Only" role grants exactly ["traces:create"]

  # ---------------------------------------------------------------------------
  # Issue — happy path
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @issue
  Scenario: Issuing an ingestion key mints an ApiKey with an ingest-only project role
    When jane requests an ingestion key for "personal-jane" with sourceType "claude_code"
    Then an ApiKey row is created with:
      | column            | value                                          |
      | parentApiKeyId    | the session's CLI login key id                 |
      | hashedSecret      | HMAC-SHA256(secret, pepper)                    |
      | ingestSourceType  | "claude_code"                                  |
      | ingestionTemplateId | NULL (no template for a unified CLI tool)    |
      | revokedAt         | NULL                                           |
    And a RoleBinding row is created with:
      | column        | value                          |
      | apiKeyId      | (the new key id)               |
      | scopeType     | PROJECT                        |
      | scopeId       | "personal-jane"                |
      | customRole    | "Ingest Only" (traces:create)  |
    And the plaintext token is shown exactly once with the `ik-lw-` prefix
    And re-requesting the same (project, sourceType) adds a key, never 409

  @bdd @ingest-api-key @issue @structural-impossibility
  Scenario: Personal ingest-key issuance derives the project from auth, not input
    When the personal ingest-key issue RPC schema is inspected
    Then the input has { organizationId, sourceType } and derives userId from ctx.session.user.id
    And the input schema MUST NOT include a personalProjectId field
    # Server resolves the caller's personal project; cross-user issuance is unrepresentable.

  # ---------------------------------------------------------------------------
  # Project-scoped mint from the CLI
  # ---------------------------------------------------------------------------
  # `POST /api/auth/cli/governance/ingestion-key` also mints into a named team
  # project, so a repository checkout can send its coding-agent traces to the
  # project that owns the code instead of the developer's personal workspace.
  # The named-project mint is create-only: two machines working on the same
  # repository each keep their own live key, and revoking one leaves the other
  # working. Omitting `project` mints into the personal workspace on the same
  # terms, under the session's login key (see the personal-session scenarios
  # below). A project-pinned key is an org service key: it has no session and
  # no lifecycle beyond a person's revoke.

  @integration @ingest-api-key @issue @project-scoped
  Scenario: The CLI mints an ingestion key for a project named by id
    Given jane holds a device session in organization "acme"
    And jane has traces:create on team project "checkout-api"
    When the CLI POSTs `{ source_type: "claude_code", project: "<the project id>" }`
    Then the response status is 201
    And the body carries the one-time `token`, its `prefix`, the OTLP `endpoint`
    And the body carries `project` with the resolved id, slug and name
    And the key is bound to "checkout-api" only

  @integration @ingest-api-key @issue @project-scoped
  Scenario: The CLI mints an ingestion key for a project named by slug
    Given jane holds a device session in organization "acme"
    And jane has traces:create on team project "checkout-api"
    When the CLI POSTs `{ source_type: "claude_code", project: "checkout-api" }`
    Then the response status is 201
    And the resolved project in the body is "checkout-api"

  @integration @ingest-api-key @issue @project-scoped
  Scenario: Minting into a project the caller cannot write to is refused
    Given jane holds a device session in organization "acme"
    And jane has no traces:create on team project "payments-api"
    When the CLI POSTs `{ source_type: "claude_code", project: "payments-api" }`
    Then the response status is 403
    And the response body contains `{ "error": "forbidden" }`
    And no ingestion key is created

  @integration @ingest-api-key @issue @project-scoped
  Scenario: A project in another organization is not found
    Given jane holds a device session in organization "acme"
    And project "other-co-api" belongs to organization "other-co"
    When the CLI POSTs `{ source_type: "claude_code", project: "other-co-api" }`
    Then the response status is 404
    And the response body contains `{ "error": "project_not_found" }`
    And nothing tells jane whether that project exists elsewhere

  @integration @ingest-api-key @issue @project-scoped @create-only
  Scenario: Two machines each keep a live key for the same project and tool
    Given jane already minted an ingestion key for "checkout-api" and "claude_code"
    When her second machine mints one for the same project and source type
    Then both tokens authorize trace writes into "checkout-api"
    And neither key is revoked by the other

  # ---------------------------------------------------------------------------
  # Personal-workspace mint from the CLI: one key per session
  # ---------------------------------------------------------------------------
  # The personal mint used to rotate in place, so any one machine's setup
  # silently revoked the key every other machine was still exporting with.
  # It is create-only now, and every key it mints is parented to the CLI
  # login key of the session that asked for it. That parent is what retires
  # the key later; the mint itself never revokes anything.

  @integration @ingest-api-key @issue @personal @create-only
  Scenario: Two devices each keep a live personal key for the same tool
    Given jane's laptop already minted a personal ingestion key for "claude_code"
    When her second device mints one for the same source type
    Then both tokens authorize trace writes into her personal workspace
    And neither key is revoked by the other

  @integration @ingest-api-key @issue @personal @session
  Scenario: A key minted by a CLI session is parented to that session's login key
    Given jane holds a device session whose login key is K
    When the CLI mints a personal key for "claude_code"
    Then the new key's parentApiKeyId is K
    And its device label is the same normalized label the login key carries

  @integration @ingest-api-key @issue @personal @session
  Scenario: A mint from a session whose login key is revoked is refused as signed out
    Given jane holds a device session whose login key was revoked
    When the CLI mints a personal key for "claude_code"
    Then the response status is 401
    And no ingestion key is created
    # The CLI reads a 401 here as "sign in again", which is the repair.

  # ---------------------------------------------------------------------------
  # A personal key lives and dies with its CLI session
  # ---------------------------------------------------------------------------
  # Four things retire a login key: `langwatch logout`, the revoke on the
  # devices tab, a re-login from the same device, and the session running out
  # (the refresh window, or the organization's max session duration). Each of
  # them retires the ingest keys under that login key with cause "session"
  # or "expired". Keys under another session are never touched.

  @integration @ingest-api-key @session @logout
  Scenario: Logging out retires the session's ingest keys and leaves another session's live
    Given jane's laptop and desktop each hold a device session and a "claude_code" key
    When the laptop calls logout with its tokens
    Then the laptop's login key and ingest key are revoked with cause "session"
    And the desktop's key still authorizes trace writes

  @integration @ingest-api-key @session @revoke
  Scenario: Revoking a device from the devices tab retires its login key and its ingest keys
    Given jane's laptop and desktop each hold a device session and a "claude_code" key
    When jane revokes the laptop session from the devices tab
    Then the laptop's tokens are gone from Redis
    And the laptop's login key and ingest key are revoked
    And the desktop's key still authorizes trace writes

  @integration @ingest-api-key @session @revoke
  Scenario: Revoking every device retires every session's keys
    Given jane's laptop and desktop each hold a device session and a "claude_code" key
    When jane revokes all devices
    Then both login keys and both ingest keys are revoked

  @unit @ingest-api-key @session
  Scenario: A re-login from the same device retires the keys of the session it replaces
    Given a device that signs in again under the same label
    When the previous login key is replaced
    Then the ingest keys parented to it are revoked with cause "session"
    And the new session starts with none

  @integration @ingest-api-key @session @expiry
  Scenario: A session past its ceiling has its keys retired with cause expired
    Given jane's session started longer ago than the organization's max session duration
    When the CLI refreshes the session
    Then the refresh is refused
    And the session's login key and ingest key are revoked with cause "expired"

  @unit @ingest-api-key @session @expiry
  Scenario: The reaper retires login keys whose session window ran out
    Given a CLI login key whose expiry passed and one whose expiry has not
    When the hourly sweep runs
    Then only the elapsed key is revoked, with cause "expired"
    And the ingest keys under it are revoked with it

  @unit @ingest-api-key @session @expiry
  Scenario: A refresh extends the login key's expiry with the session
    Given a CLI login key minted with the session
    When the CLI refreshes the session
    Then the login key's expiry moves to the new refresh window
    But never past the organization's max session duration from the session start

  @unit @ingest-api-key @session
  Scenario: A cascade that fails does not fail the logout
    Given a login key whose ingest keys cannot be revoked
    When the login key is revoked
    Then the login key is still revoked and the caller is not told of a failure
    And the failure is logged

  # The CLI is not the only door to a personal key. Connecting a source from
  # the /me tile, and the MCP mint an agent calls, reach the same workspace.
  # They have no session to parent a key to, so they mint only for sources a
  # published template names and no CLI wrapper covers; a key for a wrapped
  # tool comes from the CLI on the machine that runs it, and nowhere else.

  @integration @ingest-api-key @issue @personal @create-only
  Scenario: Connecting a template source from the personal tile adds a key
    Given a published template names source type "claude_cowork"
    And jane already connected "claude_cowork" from her personal ingest tile
    When she connects it again
    Then both tokens authorize trace writes into her personal workspace
    And neither key is revoked by the other

  @integration @ingest-api-key @issue @personal @create-only
  Scenario: An agent minting a template source through MCP adds a key
    Given a published template names source type "claude_cowork"
    And jane already connected "claude_cowork" from her personal ingest tile
    When an agent mints a personal key for "claude_cowork" through the MCP tool
    Then both tokens authorize trace writes into her personal workspace
    And neither key is revoked by the other

  @integration @ingest-api-key @issue @personal
  Scenario: The tile and the MCP mint refuse a tool the CLI wraps
    When jane connects "claude_code" from her personal ingest tile
    Then the request is refused with code "ingestion_key_source_not_allowed"
    When an agent mints a personal key for "claude_code" through the MCP tool
    Then the request is refused the same way
    And no ingestion key is created

  @unit @ingest-api-key @issue @personal
  Scenario: A mint outside a CLI session accepts only a template-named source
    Given a personal mint from the tile or the MCP tool
    When it names a source type no published template names
    Then no key is created
    And a source type a published template names is minted

  @integration @ingest-api-key @issue @personal @create-only
  Scenario: A personal key is minted only for a tool the CLI wraps
    Given jane holds a device session
    When the CLI POSTs a personal mint for a source type no wrapped tool stamps
    Then the response status is 400
    And no ingestion key is created under that source type

  # A person can retire one key, or every key of one source across machines.
  # Rotating a template source from the tile is the second followed by a
  # fresh mint: the person pastes the new token wherever the old one was.

  @integration @ingest-api-key @revoke @personal
  Scenario: A person revokes one of their own ingestion keys
    Given jane holds two personal ingestion keys
    When she revokes one of them
    Then that token no longer authorizes trace writes, with cause "user"
    And the other still does
    And revoking it again is not an error

  @integration @ingest-api-key @revoke @personal @security
  Scenario: Revoking another person's ingestion key answers not found
    Given ben holds a personal ingestion key in "acme"
    When jane tries to revoke it
    Then the request is refused with code "ingestion_key_not_found"
    And ben's key still authorizes trace writes

  @integration @ingest-api-key @rotate @personal
  Scenario: Rotating a template source from the tile revokes every key for it and says how many
    Given jane's personal workspace holds three live "claude_cowork" keys
    When she rotates "claude_cowork" from her personal ingest tile
    Then the answer says three keys were revoked and names their machines
    And the rotated key is the only live one
    And none of the previous tokens authorize trace writes

  @integration @ingest-api-key @rotate @personal
  Scenario: Rotate says how many keys it revokes and which machines hold them
    Given jane has two live "claude_cowork" keys, on "MacBook Pro" and on a machine with no label
    When she opens the install drawer for that source on her personal ingest tile
    Then the warning names both machines and says two keys will be revoked
    And a key with no machine label is named "unknown device"
    And the rotate button says how many keys it revokes

  @unit @ingest-api-key @rotate
  Scenario: A rotation that cannot kill every prior key mints nothing
    Given a rotation over several live keys
    When one of them cannot be revoked
    Then every other prior key is still attempted
    And no new key is minted
    And the error names the keys that survived

  # ---------------------------------------------------------------------------
  # Revocation records its cause
  # ---------------------------------------------------------------------------
  # A device whose key died asks the platform why before it re-mints. The
  # platform's own revocations name themselves: "session" when the login key
  # the ingest key was parented to was revoked, "expired" when that session
  # ran out, "rotation" when a re-login replaced the login key. Everything a
  # person does through the API-keys page or the REST API is recorded as that
  # person's decision, and the CLI leaves such a key dead until the person
  # sets the device up again.

  @unit @ingest-api-key
  Scenario: A revoke from the API keys page records a person as its cause
    Given jane revokes one of her keys from the API keys page
    When the row is written
    Then its revocation cause is "user"

  @unit @ingest-api-key @session
  Scenario: A re-login names rotation as the cause of the login key it replaces
    Given a device that signs in again under the same label
    When the previous login key is revoked
    Then its revocation cause is "rotation"
    And the ingest keys under it name "session"

  @integration @ingest-api-key @issue @personal
  Scenario: The CLI can ask what became of its own key
    Given jane's device minted a personal key and a person then revoked it
    When the CLI asks the platform about that key's lookup id
    Then the answer is revoked, with "user" as the cause
    And a key retired with its session answers with "session"
    And a key that is still live answers live
    And a lookup id that names none of jane's keys answers unknown

  # A person's revoke and a session cascade can land on one key at the same
  # moment. The cause is what the CLI reads to decide whether it may mint a
  # replacement, so the first revocation keeps it: a "session" written over
  # a "user" would let a device mint its way past the decision made on the
  # API-keys page.

  @integration @ingest-api-key @issue @personal
  Scenario: The first revocation decides the recorded cause
    Given a personal key a person revoked
    When a session cascade, which read the key live, lands after it
    Then the key still names "user" as the cause

  # ---------------------------------------------------------------------------
  # Ingest-only RBAC — the genuinely-write-only guarantee
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @ingest-only @rbac
  Scenario Outline: An ingest key authorizes trace writes and nothing else
    Given jane holds an ingestion key for "personal-jane"
    When the key is presented to "<endpoint>" requiring "<permission>"
    Then the request is "<outcome>"

    Examples:
      | endpoint                | permission       | outcome  |
      | POST /api/otel/v1/traces| traces:create    | allowed  |
      | POST /api/collector     | traces:create    | allowed  |
      | GET trace query API     | traces:view      | denied   |
      | DELETE a trace          | traces:delete    | denied   |
      | governance admin API    | governance:manage| denied   |
      | list virtual keys       | virtual_keys:view| denied   |
    # The Ingest-Only role grants only traces:create, so every non-write call
    # fails the API-key permission ceiling with 403.

  # ---------------------------------------------------------------------------
  # Rotation — HARD-CUT
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @rotation @hard-cut
  Scenario: Rotating an ingestion key revokes the previous token immediately
    Given jane has an ingestion key with token T_OLD
    When jane rotates the key
    Then a new token T_NEW is issued and shown one-time with the `ik-lw-` prefix
    And `hashedSecret` is updated to HMAC-SHA256(T_NEW's secret)
    When jane's upstream tool emits a trace using T_OLD
    Then the receiver returns 401 (token miss, no enumeration)
    # Hard-cut v1: no grace window.

  # ---------------------------------------------------------------------------
  # Revocation — past traces stay
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @revoke
  Scenario: Revoking an ingestion key stops new writes, keeps past traces
    Given jane has an ingestion key that has emitted 14 traces into "personal-jane"
    When jane revokes the key
    Then the ApiKey row's `revokedAt` is set to now()
    But the 14 prior traces remain attributed to "personal-jane"
    And new emits using the revoked token return 401

  # ---------------------------------------------------------------------------
  # Provenance stamping — receiver-authoritative
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @provenance
  Scenario: The receiver stamps source + key provenance from the resolved ingest key
    Given jane holds an ingestion key with ingestSourceType "claude_code"
    When jane's upstream tool emits a span authorized by that key
    Then the receiver stamps, post-resolution, authoritative attributes:
      | attribute            | value (source)                              |
      | langwatch.source     | "claude_code" (from ingestSourceType)       |
      | langwatch.api_key.id | the ingest key id                           |
      | langwatch.origin     | "coding_agent" (derived from ingestSourceType) |
      | langwatch.project.id | "personal-jane" (the bound project)         |
    And `langwatch.template.id` is stamped ONLY when ingestionTemplateId is set

  # ---------------------------------------------------------------------------
  # Template-derived ingest key (claude_cowork) — OTTL still applies
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @template-derived
  Scenario: An admin template install issues an ingest key that carries its template
    Given the platform IngestionTemplate "claude_cowork" exists
    When jane installs the "claude_cowork" template
    Then the issued ingestion key has ingestionTemplateId = (claude_cowork id)
    And the receiver applies that template's ottlRules to the key's traces
    And stamps `langwatch.template.id` = (claude_cowork id) and `langwatch.source` = "claude_cowork"
    # The template survives as OTTL/catalog metadata; the credential is an ingest key.

  # ---------------------------------------------------------------------------
  # Cross-project isolation
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @isolation
  Scenario: An ingest key only writes to its bound project
    Given ben has personal project "personal-ben" with his own ingestion key
    When jane fires 5 traces with her key and ben fires 3 with his
    Then jane's /me/traces shows her 5 (bound to "personal-jane")
    And ben's /me/traces shows his 3 (bound to "personal-ben")
    And neither key can write into the other's project

  # ---------------------------------------------------------------------------
  # Team projects get ingest keys too (uniform)
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @team-project
  Scenario: A team project mints an ingest-only key the same way
    Given organization "acme" has a team project "shared-app"
    And the caller has aiTools:manage on "acme"
    When an ingestion key is issued for "shared-app" with sourceType "claude_code"
    Then an ApiKey(keyType="ingest") is created bound to "shared-app" with the Ingest Only role
    And it authorizes OTLP writes into "shared-app" and nothing else
    # Same primitive, same ingest-only role; not a personal-only concept.

  # ---------------------------------------------------------------------------
  # List visibility: personal ingest keys are private to their owner
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @isolation @security
  Scenario: Personal ingestion keys are not listed to other organization members
    Given jane and ben each hold a personal ingestion key in "acme"
    When ben opens Settings > API Keys as a non-admin member
    Then ben sees his own ingestion key but not jane's
    And ben does not see org-owned (userId-null) ingestion keys
    # Personal ingest keys are user-owned, so the API-key list scopes them to
    # their owner; org-owned ingest keys stay admin-only.

  # ---------------------------------------------------------------------------
  # Activity tracking — lastUsedAt, not audit volume
  # ---------------------------------------------------------------------------

  @bdd @ingest-api-key @activity
  Scenario: Per-trace activity updates lastUsedAt without audit volume
    Given jane has an ingestion key with lastUsedAt = NULL
    When jane's upstream tool emits 1000 traces over 5 minutes
    Then the key's `lastUsedAt` reflects the most recent trace timestamp
    But NO audit rows are emitted per trace
    And only the issue / rotate / revoke state-changes emit audit rows

  # ---------------------------------------------------------------------------
  # Pull-source key suppression — #7616
  # ---------------------------------------------------------------------------
  # Pull-mode and S3-mode sources authenticate outbound (workspace tokens,
  # client secrets, S3 credentials stored in parserConfig). They never
  # receive inbound OTLP pushes, so the `lw_is_*` ingest secret is dead
  # weight: generated, hashed, stored, shown to the admin, never used.
  #
  # The `ingestSecretHash` column is non-nullable (String, not String?),
  # so the suppression stores an empty-string sentinel rather than NULL.
  # `findByIngestSecret` hashes inbound tokens before matching, so ""
  # can never collide with a real hash — the sentinel is inert.

  @bdd @ingest-api-key @pull-source @suppression
  Scenario: Creating a pull-mode source does not generate an ingest secret
    When jane creates an ingestion source with sourceType "copilot_studio_dataverse"
    Then the IngestionSource row has `ingestSecretHash` = "" (empty sentinel)
    And the create response carries `ingestSecret` = null
    And no secret modal is shown to the admin

  @bdd @ingest-api-key @pull-source @suppression
  Scenario: Creating an S3-mode source does not generate an ingest secret
    When jane creates an ingestion source with sourceType "openai_compliance"
    Then the IngestionSource row has `ingestSecretHash` = "" (empty sentinel)
    And the create response carries `ingestSecret` = null
    And no secret modal is shown to the admin

  @bdd @ingest-api-key @pull-source @suppression
  Scenario: Creating an s3_custom source generates a secret for webhook callback
    When jane creates an ingestion source with sourceType "s3_custom"
    Then the IngestionSource row has a real `ingestSecretHash` (non-empty)
    And the create response carries `ingestSecret` with a valid `lw_is_` prefix
    And the secret modal is shown to the admin

  @bdd @ingest-api-key @pull-source @suppression
  Scenario: Creating a push-mode source still generates an ingest secret
    When jane creates an ingestion source with sourceType "claude_code"
    Then the IngestionSource row has a real `ingestSecretHash` (non-empty)
    And the create response carries `ingestSecret` with a valid `lw_is_` prefix
    And the secret modal is shown to the admin

  @bdd @ingest-api-key @pull-source @rotation-guard
  Scenario: Rotating a pull-mode source's secret is refused
    Given jane has a pull-mode source with sourceType "databricks_genie"
    When jane requests a secret rotation for that source
    Then the rotation is refused with a validation error
    And the source's ingestSecretHash remains "" (empty sentinel)

  @bdd @ingest-api-key @pull-source @rotation-guard
  Scenario: Rotating a push-mode source's secret still works
    Given jane has a push-mode source with sourceType "otel_generic"
    When jane requests a secret rotation for that source
    Then a new secret is minted and the prior hash enters the grace window
