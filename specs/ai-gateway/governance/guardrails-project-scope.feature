Feature: AI Gateway — GatewayGuardrail is a project-scoped first-class resource

  Guardrails graduate from VK-embedded config to a top-level table:
  `GatewayGuardrail`. They are project-scoped only (for now), exposed as
  their own admin surface at `/settings/gateway/guardrails`, and VKs
  attach to them by reference (`{direction, guardrailId[]}` tuples) rather
  than embedding the evaluator + failure-mode config inline. This lets
  operators apply gateway guardrails per project without re-authoring
  them on every VK they mint, and prevents drift across keys that should
  all enforce the same project rule.

  Per rchaves: "guardrails are project level only (for now)". The schema
  uses a single `projectId` FK column (no scope join table). Widening to
  team/org guardrails later is a clean ADD of `GatewayGuardrailScope`,
  not a refactor.

  Background:
    Given organization "acme" has team "platform" with project "demo"
    And evaluator "eval-pii-v2" exists at PROJECT "demo" with executionMode=AS_GUARDRAIL
    And evaluator "eval-toxicity-v3" exists at PROJECT "demo" with executionMode=AS_GUARDRAIL

  # ============================================================================
  # Schema invariant: projectId only, no scope cascade
  # ============================================================================

  @bdd @guardrails @schema @unimplemented
  Scenario: GatewayGuardrail row carries projectId only (no scope join table)
    When the post-refactor schema is inspected
    Then `GatewayGuardrail` has a non-null `projectId` column
    And there is NO `GatewayGuardrailScope` join table
    And there is NO `organizationId` or `teamId` column on `GatewayGuardrail`
    And widening to team/org later is documented as "add GatewayGuardrailScope join table; this column drops to nullable + scope rows seed from projectId at migration time"

  @bdd @guardrails @schema @r3 @unimplemented
  Scenario: vk.config.guardrails is dropped from VirtualKey after the backfill
    When the post-refactor schema is inspected
    Then `VirtualKey.config` has no `guardrails` key
    And every VK that previously embedded a guardrail config has either:
      | path                       | when                                                      |
      | a GatewayGuardrail row     | the embedded config was non-empty for the VK's project    |
      | nothing                    | the embedded config was empty                             |
    And VK→guardrail attachments live in `VirtualKey.config.guardrailAttachments[]` as `{direction, guardrailId[]}` tuples

  # ============================================================================
  # Admin surface: /settings/gateway/guardrails
  # ============================================================================

  @bdd @guardrails @ui @unimplemented
  Scenario: New top-level admin page lists project guardrails with create/edit/delete
    Given user "carol@acme.com" holds `gatewayGuardrails:view` + `gatewayGuardrails:manage` at PROJECT "demo"
    When carol navigates to /settings/gateway/guardrails
    Then the page lists every GatewayGuardrail row where projectId = "demo"
    And each row shows: name, evaluator (linked), direction(s), failure mode (fail_open / fail_closed), attached-VK count
    And the page has "+ New guardrail" CTA
    And the AiGatewayLayout sub-nav has a "Guardrails" entry between "Cache rules" and "Usage"

  @bdd @guardrails @ui @unimplemented
  Scenario: Create-guardrail drawer enforces project-scope schema invariant
    Given carol is on /settings/gateway/guardrails
    When carol clicks "+ New guardrail"
    Then the drawer renders fields: name, evaluator (filtered to AS_GUARDRAIL mode within PROJECT "demo"), direction (pre / post / stream_chunk), failure mode toggle (fail_open / fail_closed)
    And there is NO scope picker (project is implicit from the current project context)
    And the create button writes `{projectId: "demo", ...}` with no scope row

  # ============================================================================
  # VK opt-in / opt-out: attachments live on VK
  # ============================================================================

  @bdd @guardrails @vk-attach
  Scenario: VK attaches existing GatewayGuardrail rows by reference
    Given two GatewayGuardrail rows in PROJECT "demo": "gr-pii" (direction=pre) and "gr-toxicity" (direction=post)
    And a VirtualKey "vk-strict" scoped to PROJECT "demo"
    When carol opens vk-strict's edit drawer
    Then the "Guardrails" section lists every GatewayGuardrail in the VK's project, grouped by direction
    And each guardrail shows a checkbox to attach/detach for that direction
    When carol attaches "gr-pii" on pre and "gr-toxicity" on post
    Then `vk-strict.config.guardrailAttachments` equals `[{direction:"pre", guardrailIds:["gr-pii"]}, {direction:"post", guardrailIds:["gr-toxicity"]}]`
    And the bundle ships `guardrail_attachments` of the same shape

  @bdd @guardrails @vk-attach @cross-project
  Scenario: VK cannot attach a guardrail from a different project
    Given GatewayGuardrail "gr-other" exists in PROJECT "ml-prod" (NOT "demo")
    And a VirtualKey "vk-demo" scoped to PROJECT "demo"
    When the VK service is asked to attach "gr-other" to "vk-demo"
    Then the call returns BAD_REQUEST with code "guardrail_project_mismatch"
    And the VK config is unchanged

  # ============================================================================
  # Bundle wire shape — guardrails ship per-project flat list
  # ============================================================================

  @bdd @guardrails @bundle @unimplemented
  Scenario: Bundle materialiser ships project guardrails flat with VK attachments referencing them
    Given a VirtualKey "vk-strict" with attachments `[{direction:"pre", guardrailIds:["gr-pii"]}]`
    When the materialiser emits the bundle
    Then `bundle.guardrails[]` is a flat list of every GatewayGuardrail in the VK's project
    And `bundle.guardrail_attachments[]` is the VK's `{direction, guardrailIds[]}` tuples
    And the Go gateway dispatcher reads `guardrail_attachments` to know which `guardrails[]` to invoke per direction

  # ============================================================================
  # RBAC — granular perm strings
  # ============================================================================

  @bdd @guardrails @rbac @unimplemented
  Scenario: gatewayGuardrails:view is required to list guardrails
    Given user "ariana@acme.test" holds NO gatewayGuardrails perms at PROJECT "demo"
    When ariana navigates to /settings/gateway/guardrails
    Then the page returns 403 / "missing_perm:gatewayGuardrails:view"

  @bdd @guardrails @rbac @unimplemented
  Scenario: gatewayGuardrails:manage is required to create / edit / delete
    Given user "ariana@acme.test" holds `gatewayGuardrails:view` but NOT `gatewayGuardrails:manage` at PROJECT "demo"
    When ariana clicks "+ New guardrail"
    Then the action returns FORBIDDEN with code "missing_perm:gatewayGuardrails:manage"
    And the same denial applies to edit and delete actions on existing rows

  @bdd @guardrails @rbac
  Scenario: gatewayGuardrails:attach is required on the VK side to wire a guardrail to a VK
    Given user "ariana@acme.test" holds `virtualKeys:manage` + `gatewayGuardrails:view` but NOT `gatewayGuardrails:attach`
    When ariana saves a VK with a non-empty `guardrailAttachments` list
    Then the call returns FORBIDDEN with code "missing_perm:gatewayGuardrails:attach"

  @bdd @guardrails @rbac @role-defaults @unimplemented
  Scenario: Default role grants for the new perms
    Then PROJECT:ADMIN holds `gatewayGuardrails:{view,manage,attach}` at the project scope
    And PROJECT:DEVELOPER holds `gatewayGuardrails:{view,attach}` (can wire a guardrail to their own VK, cannot create new ones)
    And PROJECT:VIEWER holds `gatewayGuardrails:view` only
    And ORGANIZATION:ADMIN holds `gatewayGuardrails:{view,manage,attach}` at every project in the org (cascade via existing org-admin convention)

  # ============================================================================
  # Audit emission
  # ============================================================================

  @bdd @guardrails @audit @unimplemented
  Scenario: Every create / edit / archive / VK-attach emits an AuditLog row
    When carol performs any of: create guardrail, edit guardrail, archive guardrail, attach guardrail to a VK, detach guardrail from a VK
    Then exactly one AuditLog row is emitted per action with:
      | field      | shape                                                              |
      | action     | one of gateway.guardrail.{created,updated,archived}                |
      |            | OR gateway.virtual_key.{guardrail_attached,guardrail_detached}     |
      | actorId    | carol's userId                                                     |
      | targetId   | the GatewayGuardrail id (CRUD) or VK id (attach/detach)            |
      | category   | "configuration_change"                                             |
    # Naming convention matches the existing gateway.<entity_snake>.<verb_past>
    # shape (gateway.virtual_key.{created,updated,rotated,revoked} etc).
    # Delete is "archived" because GatewayGuardrail uses soft-delete via
    # archivedAt — no hard-delete path exists.
    # VK-side attach/detach actions are filed under gateway.virtual_key.*
    # because the AuditLog target is the VK row that opted in, not the
    # guardrail row itself. CRUD actions live on the guardrail target.

  # ============================================================================
  # Re-scoping revalidates existing attachments against the new project
  # ============================================================================

  @bdd @guardrails @rbac
  Scenario: Re-scoping a VK to a new project revalidates the existing guardrail attachments against that project
    Given a virtual key scoped to project "demo" with a guardrail attached from "demo"
    When carol re-scopes the virtual key to project "other" without re-sending its config
    Then the update is rejected with "guardrail_project_mismatch"
    Because the previously-attached guardrail belongs to "demo", not "other"
    And the virtual key is not moved, so its attachments never dangle across projects
    # Guards the gap where only the request's attachments were validated:
    # a project move that left config untouched used to strand the old
    # attachment pointing at a guardrail the new project can't see.
