Feature: AI Gateway Governance — Admin OTTL Authoring
  As an org admin curating IngestionTemplates for my organization
  I want to author / edit OTTL transform rules in a per-statement
  editor with async validation and a save-with-audit lifecycle
  So that I can adapt platform-default templates to my org's
  upstream-tool quirks without filing a request for a custom template,
  and so my employees' personal-workspace traces land in our canonical
  shape regardless of what the upstream tool emits

  Per gateway.md "admin OTTL authoring":
    Admin opens the IngestionTemplate detail page (in the
    /settings/governance/tool-catalog Ingestion Templates tab) and clicks
    "Edit OTTL". The OttlEditor (existing component at
    @ee/governance/dashboard/components/OttlEditor) opens with the
    current ottlRules as a per-statement list, async validates each
    statement against the gateway's `pkg/ottl` parser via
    `api.ingestionSources.validateOttl`, and shows per-statement error
    coordinates (line/col) inline.

  Per template-ottl-principal-guard.feature:
    The 19-key `protectedTemplateAttributeKeys` closed list applies to
    the OTTL the admin authors. Admin OTTL CANNOT rewrite attribution
    or provenance keys. Forge attempts emit
    `gateway.template_ottl_protected_field_attempt`.

  Background:
    Given organization "acme" exists
    And admin "carol@acme.com" has the `organization:manage` permission
    AND `ingestionTemplate:manage` (org-scoped)
    And the platform-published "claude_code" template exists with
        `organizationId IS NULL` and empty `ottlRules`

  # ---------------------------------------------------------------------------
  # Open the Monaco editor on a platform-default template
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-authoring @open-editor @platform-default-fork
  Scenario: Admin clones a platform-default template to author OTTL
    When carol opens the platform claude_code template row in the
        IngestionTemplates editor and clicks "Clone to customise"
    Then the platform row is read-only; the action calls
        `ingestionTemplates.cloneFromPlatform({ templateId, organizationId })`
    And a new IngestionTemplate row is created with:
      | column         | value                                           |
      | slug           | claude_code-<nanoid> (slug-disambiguated)       |
      | sourceType     | claude_code (same)                              |
      | organizationId | "acme" (NOT NULL — org-authored row)            |
      | ottlRules      | (copied from the platform row as starter)       |
      | parentTemplateId | (platform-default's id, for provenance)        |
    And the Edit OTTL drawer opens on the new org row with the OttlEditor
        loaded against the cloned starter (admin can refine from there)
    And acme's existing UserIngestionBindings for slug "claude_code" are
        re-pointed to the new fork on next trace receive (not snapshot —
        runtime-resolved per ingestion-templates-catalog.feature)

  @bdd @template-ottl-authoring @open-editor @org-fork-direct-edit
  Scenario: Admin edits an existing org-authored template directly (no fork)
    Given acme already has an org-authored row at templateId "tpl_acme_claude_code"
    When carol clicks "Edit OTTL" on that row
    Then NO clone affordance appears (it's already an org-authored row);
        the action calls `ingestionTemplates.updateOttlRules` directly
    And the Edit OTTL drawer opens with the OttlEditor loaded with the
        current `ottlRules` content
    And the drawer header shows "Edit OTTL — <displayName>" so the admin
        knows which template they're editing

  # ---------------------------------------------------------------------------
  # Editor surface
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-authoring @editor @ergonomics
  Scenario: Editor surface reuses the existing OttlEditor component
    When the editor opens
    Then it uses the existing `OttlEditor` component at
        `@ee/governance/dashboard/components/OttlEditor` — no new editor
        implementation; same component IngestionSources already uses
    And it has:
      | feature                       | shape                                                  |
      | Per-statement Textarea list   | one Chakra Textarea per OTTL statement, add/remove rows |
      | Async validation (debounced)  | 600ms debounce → `api.ingestionSources.validateOttl` against gateway `pkg/ottl` |
      | Per-statement error display   | inline message + line/col coordinates from parser      |
      | Starter template auto-fill    | source-type-specific starter from `api.ingestionSources.ottlStarter` (suppressible by caller) |
      | Save button                   | "Save & validate" — drawer-level submit                |
      | Cancel button                 | "Discard changes" — drawer-level cancel                |
    # Note: a Monaco-based editor with full grammar highlighting +
    # preview pane is a possible follow-on refinement; the current per-
    # statement Textarea + async validation surface is what shipped in
    # this PR (Alexis at d61842a3f) per rchaves's "use what we already
    # have" directive.

  @bdd @template-ottl-authoring @editor @validation-on-save
  Scenario: Save triggers OTTL syntax + protected-key validation server-side
    Given carol has authored OTTL that includes a syntax error
    When she clicks "Save & validate"
    Then the server runs `validateOTTL(rules, mode="dryRun")`
    And the response surfaces the parser error inline at the offending
        line (per-statement error message + line/col coordinates from
        the gateway `pkg/ottl` parser, plus an error toast)
    And the template's `ottlRules` is NOT updated until validation passes

  @bdd @template-ottl-authoring @editor @protected-key-rejection
  Scenario: Save rejects OTTL that would write protected keys
    Given carol has authored OTTL containing
        `set(attributes["langwatch.user.id"], "different.user@acme.com")`
    When she clicks "Save & validate"
    Then the server's static-analysis pass detects the write to a 19-key
        protected attribute and rejects with HTTP 422 + error payload
        `{ rejectedKeys: ["langwatch.user.id"], category: "attribution",
           remediation: "Attribution keys are receiver-stamped post-OTTL.
           Remove this set() call." }`
    And the template's `ottlRules` is NOT updated
    # Static rejection at save-time complements the runtime guard at receive-
    # time: admin learns about the violation BEFORE traces start landing
    # with the audit row firing at scale.

  # ---------------------------------------------------------------------------
  # Successful save + propagation
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-authoring @save @propagation
  Scenario: Successful save emits audit row + propagates on next trace
    Given carol authored valid OTTL that maps `cursor.workspace.path` →
        `langwatch.cursor.workspace`
    When she clicks "Save & validate" and the server accepts
    Then the template's `ottlRules` is updated atomically
    And an audit row `gateway.ingestion_template.updated` is emitted with payload:
      | field          | value                                          |
      | templateId     | tpl_acme_claude_code                            |
      | actorUserId    | carol.id                                        |
      | rulesHashBefore | sha256(prev rules)                             |
      | rulesHashAfter  | sha256(new rules)                              |
      | rulesDiffKb    | size of diff in kilobytes (for forensics)      |
    And the audit row mirrors to OCSF via the existing fold pipeline
    And jane's NEXT trace through her cursor binding picks up the new rule
        (template-update-propagation per user-ingestion-binding-lifecycle.feature)

  # ---------------------------------------------------------------------------
  # Authorization
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-authoring @authz
  Scenario: A non-admin cannot author or edit OTTL
    Given user "ben@acme.com" has role MEMBER
    When ben tries to PATCH the template's ottlRules via direct API
    Then the response is 403 FORBIDDEN
    And no audit row is emitted

  @bdd @template-ottl-authoring @authz @cross-org-isolation
  Scenario: An org admin cannot edit another org's authored template
    Given user "carol@acme.com" is an admin on acme
    And an org-authored template exists with organizationId="beta-corp"
    When carol tries to edit that template
    Then the response is 404 NOT_FOUND (collapse-to-NOT_FOUND, no enumeration)
    And no audit row is emitted

  @bdd @template-ottl-authoring @authz @platform-default-cannot-edit
  Scenario: Admin cannot edit a platform-default template directly
    Given the platform-default claude_code template exists with organizationId IS NULL
    When carol tries to PATCH that template's ottlRules directly
    Then the response is 403 FORBIDDEN with message
        "Platform-default templates are read-only. Fork into your org to author OTTL."
    # Forking is the only path. Direct platform-default mutation would
    # affect every org globally — catastrophic blast radius for one
    # admin's mistake.

  # ---------------------------------------------------------------------------
  # Per-template ottlRules tier-of-trust (forward-looking — once admin authoring lands)
  # ---------------------------------------------------------------------------

  @bdd @template-ottl-authoring @tier-of-trust
  Scenario: Org-authored templates carry the 19-key protection AND cost/token/model lockdown
    Given an org-authored template's OTTL is being applied to a binding-routed trace
    When the receiver applies the OTTL
    Then the 19-key `protectedTemplateAttributeKeys` guard fires post-OTTL
    AND the org-authored-template tier ALSO blocks
        `langwatch.cost.usd*` + `gen_ai.usage.*` + `gen_ai.response.model`
    # Org-authored OTTL is admin-trusted within-org but not platform-team-
    # trusted. Cost / tokens / model integrity per-org rides on the org
    # admin's review at save-time. Cross-org cost integrity is structurally
    # protected because attribution keys are receiver-stamped regardless
    # of OTTL.
