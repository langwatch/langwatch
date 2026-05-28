Feature: AI Gateway Governance — UserIngestionBinding Lifecycle
  As a personal-project user installing / updating / uninstalling an ingestion template
  I want a binding-token-driven flow that issues a server-scoped credential
  bound to my personal project, with audit emission on every state change
  So that my ingestion path is cleanly attributable to me, revocable on
  uninstall, and observable via the audit log

  Per ingestion-templates-catalog.feature + ingestion-attribution.feature:
    UserIngestionBinding is the v1 personal-ingest binding model.
    Token format: `ik-lw-<base32>` prefix-discriminated by the receiver.
    Credential lookup: `bindingAccessTokenHash` (SHA256, B-tree indexed).
    Cross-bind guard: SERVICE-LAYER. Input MUST NOT accept personalProjectId
    — server resolves via `getPersonalProjectForUser(userId, organizationId)`
    where userId comes from `ctx.session.user.id` (authentication context, not
    input) and organizationId is the caller's active workspace org passed as
    an input parameter. Multi-org users naturally select the org via the
    workspace switcher, mirroring how `PersonalWorkspaceService.ensure()` is
    parameterized.

  Per gateway.md "audit on state-change":
    Per-trace landings emit nothing audit-side; `lastSeenAt` column on the
    binding row is the activity signal. Only state changes emit audit rows.

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has a personal project "personal-jane"
    And the platform IngestionTemplate "claude_code" exists (organizationId IS NULL)
    And jane has no UserIngestionBinding rows yet

  # ---------------------------------------------------------------------------
  # Install — happy path
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @install
  Scenario: User installs the claude_code template via /me Trace Ingest tile
    When jane clicks "Install" on the claude_code tile
    Then the install drawer opens showing:
      | field            | shape                                                  |
      | OTLP endpoint    | read-only, copyable                                    |
      | Binding token    | one-time display, masked-after-copy with prefix-only   |
      | Snippet preview  | curl/env-var snippet wired to claude_code's shape      |
      | "Mark installed" | primary button                                          |
    When jane copies the token and clicks "Mark installed"
    Then a UserIngestionBinding row is created with:
      | column                       | value                                                 |
      | userId                       | jane.id                                               |
      | templateId                   | (claude_code template id)                             |
      | personalProjectId            | "personal-jane" (server-resolved, not input-accepted) |
      | bindingAccessTokenHash       | SHA256(issued token)                                  |
      | bindingAccessTokenPrefix     | first 8 chars of issued token                         |
      | enabled                      | true                                                  |
      | archivedAt                   | NULL                                                  |
      | lastSeenAt                   | NULL                                                  |
    And the tile flips to a green-checked state with "View traces →" deep-link
    And an audit row `gateway.user_ingestion_binding.installed` appears at /settings/audit-log within 5 seconds
    And an OCSF mirror row is written to `governance_ocsf_events` for the same event

  @bdd @user-ingestion-binding @install @structural-impossibility
  Scenario: Install API does NOT accept personalProjectId in the request shape
    Given jane has no UserIngestionBinding for templateId="claude_code"
    When the bindingService.install RPC schema is inspected
    Then the input schema has fields { templateId, organizationId, ...credentialSchemaFields }
    And userId is derived from `ctx.session.user.id` (NOT an input field)
    And the input schema MUST NOT include a personalProjectId field
    # Structural-impossibility shape — cross-user binding is unrepresentable.
    # See template-cross-bind-guard.feature for the runtime regression scenario.

  # ---------------------------------------------------------------------------
  # Token rotation — HARD-CUT v1
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @rotation @hard-cut
  Scenario: Rotating the binding token revokes the previous token immediately
    Given jane has an installed claude_code binding with token T_OLD
    When jane clicks "Rotate token" in the binding drawer
    Then a new token T_NEW is issued and shown one-time
    And `bindingAccessTokenHash` is updated to SHA256(T_NEW)
    And `bindingAccessTokenPrefix` is updated to T_NEW's first 8 chars
    When jane's upstream tool emits a trace using T_OLD
    Then the receiver returns 401 (token miss — no enumeration)
    And the /me Trace Ingest tile state shows "Token rotated — paste new token to upstream now to resume"
    # Hard-cut v1: NO grace-period column, NO env knob, NO deprecated_token_used audit row.
    # Grace-period defers to v2 if SOC2 review requests.

  # ---------------------------------------------------------------------------
  # Update credential metadata (static_api_key / agent_id)
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @update-credential
  Scenario: User updates optional credential metadata on a static_api_key template
    Given a hypothetical static_api_key template "x_ingest" exists
    And jane has installed "x_ingest" with apiKey="A"
    When jane updates the apiKey via the binding edit drawer to "B"
    Then `encryptedTemplateCredential` (nullable column) is re-encrypted with the pepper
    And no audit row fires for credential-content changes (PII boundary; existing pattern from API-key edits)
    But the binding's `updatedAt` column is bumped

  # ---------------------------------------------------------------------------
  # Uninstall — past traces stay
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @uninstall
  Scenario: User uninstalls a binding — past traces stay attributed to personal project
    Given jane has a claude_code binding that has been emitting traces
    And /me/traces shows 14 prior traces from claude_code
    When jane clicks "Uninstall" on the binding
    Then the binding row's `archivedAt` is set to now()
    And `enabled` is set to false
    But the 14 prior traces remain attributed to "personal-jane"
    And new emits using the (now-archived) binding token return 401
    And an audit row `gateway.user_ingestion_binding.uninstalled` appears within 5 seconds
    And an OCSF mirror row is written

  # ---------------------------------------------------------------------------
  # Activity tracking (per-trace lastSeenAt, NOT audit)
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @lastSeenAt
  Scenario: Per-trace activity updates lastSeenAt without audit volume
    Given jane has an installed claude_code binding with lastSeenAt=NULL
    When jane's upstream tool emits 1000 traces over 5 minutes
    Then the binding's `lastSeenAt` column reflects the timestamp of the most recent trace
    But NO audit rows are emitted per trace
    And the only audit-volume event from this activity is the binding's installed/uninstalled state-change

  # ---------------------------------------------------------------------------
  # Binding-rejected surface — never silent empty
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @rejected-surface @never-silent
  Scenario Outline: Tile renders a precise rejection state (never silent empty)
    Given jane's claude_code binding is in state "<binding state>"
    When jane navigates to /me Trace Ingest
    Then the tile renders "<tile copy>"
    And the tile color matches "<tile color>"

    Examples:
      | binding state         | tile copy                                 | tile color |
      | enabled, no emits yet | "No traces received yet"                  | neutral    |
      | enabled, recent emits | "Last trace <relative time> ago"          | green      |
      | archivedAt set        | "Binding disabled — re-enable to resume"  | red        |
      | integrity violation   | "Binding broken — contact support"        | red        |
      | template misbehavior  | "Template misbehavior detected — see audit" | yellow   |

  # ---------------------------------------------------------------------------
  # Template-update propagation (by-id reference, next-trace, audit on edit)
  # ---------------------------------------------------------------------------

  @bdd @user-ingestion-binding @template-update-propagation
  Scenario: Admin edits template OTTL — existing bindings see new shape on next trace
    # NOTE: admin OTTL authoring deferred v1; this scenario locks v2 behaviour
    # so the impl ships reference-by-id (not snapshot) from day one.
    Given admin authoring is enabled (v2 surface)
    And jane's claude_code binding references templateId T1
    And T1's ottlRules currently map "anthropic.usage.input_tokens" → "gen_ai.usage.input_tokens"
    When admin edits T1's ottlRules to also map a new attribute
    And jane's upstream tool emits the next trace
    Then the new ottlRules apply to that trace (not the old snapshot)
    And an audit row `gateway.ingestion_template.updated` appears
    # Bindings reference template-by-id, not template-by-snapshot.
