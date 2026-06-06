Feature: AI Gateway Governance — Ingest API Key Lifecycle
  As a user wiring an upstream tool's OTLP export into a LangWatch project
  I want a write-only "ingestion key" that is just an API key scoped to one
  project with an ingest-only role, issued / rotated / revoked through the
  one API-key primitive
  So that the credential I spray into an agent's environment can only write
  traces into that one project and nothing else, with no second credential
  type to learn or migrate

  Why one primitive (replaces the retired UserIngestionBinding):
    There is ONE credential primitive: ApiKey (HMAC-SHA256 + pepper, split
    `{prefix}{lookupId}_{secret}` format). An "ingestion key" is an ApiKey with
    `keyType = "ingest"` plus a single project-scoped RoleBinding granting the
    system "Ingest Only" role (permissions = ["traces:create"] only). Ingest
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
      | keyType           | "ingest"                                       |
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
    And re-requesting the same (project, sourceType) rotates in place, never 409

  @bdd @ingest-api-key @issue @structural-impossibility
  Scenario: Personal ingest-key issuance derives the project from auth, not input
    When the personal ingest-key issue RPC schema is inspected
    Then the input has { organizationId, sourceType } and derives userId from ctx.session.user.id
    And the input schema MUST NOT include a personalProjectId field
    # Server resolves the caller's personal project; cross-user issuance is unrepresentable.

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
      | langwatch.origin     | "ingest_key"                                |
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
