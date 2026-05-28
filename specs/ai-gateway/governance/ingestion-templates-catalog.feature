Feature: AI Gateway Governance — Ingestion Templates Catalog (personal-workspace ingest)
  As a personal-project user who wants to ingest tool-specific telemetry
  I want a curated catalog of platform-published templates that pre-shape
  upstream traces (Claude Code / Cursor / Claude cowork) into the LangWatch
  canonical span shape — plus a Raw-OTLP fallback card for ad-hoc telemetry
  So that I get cost / tokens / model populated automatically without
  hand-authoring OTTL rules in my upstream tool

  Why templates exist (per the binding-doc):
    The Anthropic-20x / OAuth-bound-tool gap is real — when a user has a
    subscription-bound tool with no API key, the gateway VK path doesn't
    apply, and direct-OTLP works but lands as raw spans without canonical
    gen_ai.* normalisation. IngestionTemplate ships the OTTL transform admin-
    side (or platform-team-side); UserIngestionBinding ships the user's
    personal-project binding token.

  Per personal-workspace-features.feature + ingestion-attribution.feature:
    NO `IngestionSource.personalProjectId` column. ever.
    UserIngestionBinding is a separate model from IngestionSource — the
    binding-doc invariant survives.

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has a personal project "personal-jane"
    And the platform ships these IngestionTemplate rows with organizationId IS NULL:
      | slug                | sourceType        | credentialSchema  | scope     |
      | claude_code         | claude_code       | NULL              | platform  |
      | cursor              | cursor            | NULL              | platform  |
      | claude_cowork       | claude_cowork     | NULL              | platform  |
    And a client-side **discovery card** "raw_otlp_advanced" renders alongside the
        platform-template tiles. The card is NOT an IngestionTemplate row — it deep-
        links to /me/settings#otlp where the user grabs the personal-project OTLP
        token. It does NOT mint a UserIngestionBinding. Its presence in the catalog
        is for discovery parity (so the no-template fallback is visible from the
        same surface as templates), not because it shares the IngestionTemplate
        contract.

  # ---------------------------------------------------------------------------
  # User catalog visibility
  # ---------------------------------------------------------------------------

  @bdd @ingestion-templates @catalog @user-visibility
  Scenario: User sees the v1 catalog on /me Trace Ingest
    When jane navigates to "/me" and scrolls to the "Trace Ingest" section
    Then she sees a tile-grid with exactly 4 visible items:
      | tile slug          | label                      | source                     |
      | claude_code        | "Connect Claude Code"      | api.ingestionTemplates.list |
      | cursor             | "Connect Cursor"           | api.ingestionTemplates.list |
      | claude_cowork      | "Connect Claude cowork"    | api.ingestionTemplates.list |
      | raw_otlp_advanced  | "Raw OTLP (advanced)"      | client-side discovery card  |
    And the three install tiles are sourced from `api.ingestionTemplates.list`
    And the raw_otlp_advanced card is rendered client-side (no server query)
    And the raw_otlp_advanced card is visually distinct from the three install tiles
        (e.g. dashed border + subtle background per Lane-B Iter 2)

  @bdd @ingestion-templates @catalog @copy-disambiguation
  Scenario: Catalog copy distinguishes auto-shape vs raw OTLP
    When jane opens the install drawer for the claude_code tile
    Then the drawer headline reads "Connect Claude Code — auto-shaped"
    And the subcopy contains "Traces normalized into gen_ai.* canonical. Cost/tokens/model populated automatically."
    But when she opens the raw_otlp_advanced card
    Then the headline reads "Bring your own OTLP — raw shape"
    And the subcopy contains "Spans land as-emitted; you control the shape. Cost/tokens/model not auto-populated unless your spans already follow gen_ai.* conventions."
    And the /me/settings "Personal OTLP Endpoint" panel headline reads "Personal OTLP Endpoint"
    And its subcopy contains "For ad-hoc / custom telemetry. Use the catalog (Trace Ingest section above) for tool-specific auto-shape."

  # ---------------------------------------------------------------------------
  # Platform-vs-org template scope
  # ---------------------------------------------------------------------------

  @bdd @ingestion-templates @catalog @platform-default-global
  Scenario: Platform-published templates (organizationId IS NULL) are visible to every org
    Given org "beta-corp" has not authored any IngestionTemplate rows
    When user "lisa@beta-corp.com" navigates to her /me Trace Ingest
    Then she sees the same 4 v1 tiles as jane

  @bdd @ingestion-templates @catalog @cross-org-isolation
  Scenario: Org-authored templates (organizationId NOT NULL) are scoped to that org only
    Given an IngestionTemplate row exists with slug "acme-internal-router" and organizationId="acme"
    When jane navigates to /me Trace Ingest
    Then she sees "acme-internal-router" alongside the 4 platform defaults
    But when lisa from "beta-corp" navigates to her /me Trace Ingest
    Then she does NOT see "acme-internal-router"
    # Org-authoring UI deferred to v2; the organizationId-NULL-vs-NOT-NULL scope
    # column is reserved v1 so cross-org isolation is correct from day one.

  # ---------------------------------------------------------------------------
  # Admin catalog surface — READ-ONLY v1
  # ---------------------------------------------------------------------------

  @bdd @ingestion-templates @admin-readonly
  Scenario: Admin sees catalog as READ-ONLY in /settings/governance/tool-catalog
    Given admin "carol@acme.com" has the `ingestionTemplate:view` permission
    When carol navigates to "/settings/governance/tool-catalog" and selects the "Ingestion Templates" tab
    # Existing P7-B6 ToolCatalogEditor surface (AiToolEntry catalog) gets a
    # second tab here. No new admin route v1.
    Then she sees the 3 platform-default IngestionTemplate rows listed
        (claude_code, cursor, claude_cowork — raw_otlp_advanced is a client-side
        card and does NOT appear in the admin templates table)
    And each template row has a "View OTTL" affordance opening a read-only modal
    But there is NO "Edit" button, NO "Disable" button, and NO "Fork" button v1
    And the page footer reads "Need a custom template? Request via [docs link]."
    # Admin OTTL authoring UI + per-org override-to-disable both defer to v2.

  # ---------------------------------------------------------------------------
  # Regression / no-leak invariants
  # ---------------------------------------------------------------------------

  # No-leak invariant: persona-aware-chrome layout component branches on
  # route shape to hide IngestionTemplate catalog under /[project]. No
  # render-route test currently sweeps the catalog component's mount sites
  # across /me and /[project]. Pin @unimplemented until that sweep test
  # lands (single Vitest assert over the mount site list is enough).
  @bdd @ingestion-templates @catalog @no-leak @regression @unimplemented
  Scenario: Trace Ingest section does NOT render under /[project] namespace
    Given jane is viewing project "/p_personal_jane/messages"
    When the page renders
    Then no "Trace Ingest" section is rendered in the project chrome
    And no IngestionTemplate-catalog-related component is mounted
    # /me Trace Ingest is a personal-workspace surface; project chrome
    # scope-limits to project-trace consumers. Per persona-aware-chrome.feature
    # invariants — no governance/personal surfaces leak under /[project].
