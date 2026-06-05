Feature: AI Gateway Governance — Ingestion Templates Catalog (personal-workspace ingest)
  As a personal-project user who wants to ingest tool-specific telemetry
  I want a curated catalog of platform-published templates that pre-shape
  upstream traces into the LangWatch canonical span shape — plus a Raw-OTLP
  fallback card for ad-hoc telemetry
  So that I get cost / tokens / model populated automatically without
  hand-authoring OTTL rules in my upstream tool

  Why templates exist (per the binding-doc):
    The OAuth / subscription-bound-tool gap is real — when a user has a
    subscription-bound tool with no API key, the gateway VK path doesn't
    apply, and direct-OTLP works but lands as raw spans without canonical
    gen_ai.* normalisation. IngestionTemplate ships the OTTL transform admin-
    side (or platform-team-side); UserIngestionBinding ships the user's
    personal-project binding token.

  Templates are NOT for the platform's coding assistants:
    The coding assistants the platform manages directly (claude_code, codex,
    cursor, gemini, opencode) are set up by the `langwatch <tool>` command and
    LangWatch converts their OTLP model-call logs into canonical gen_ai spans
    at ingest (see claude-code-log-conversion.feature). The platform owns their
    whole setup + canonicalisation, so they are simply NOT seeded as ingestion
    templates — they are coding-assistant tiles on the AiToolsPortal. There is
    no feature flag and no filter: the platform-template seed just does not
    include coding assistants, so they never exist as template rows to begin
    with.

  Per personal-workspace-features.feature + ingestion-attribution.feature:
    NO `IngestionSource.personalProjectId` column. ever.
    UserIngestionBinding is a separate model from IngestionSource — the
    binding-doc invariant survives.

  Background:
    Given organization "acme" exists
    And user "jane@acme.com" has a personal project "personal-jane"
    And the platform's coding assistants (claude_code, codex, cursor, gemini, opencode)
        are set up by `langwatch <tool>` and are NOT ingestion templates
    And the platform ships these IngestionTemplate rows with organizationId IS NULL:
      | slug          | sourceType    | credentialSchema | scope    |
      | claude_cowork | claude_cowork | NULL             | platform |
    And the platform-template seed does NOT include any coding-assistant slug
        (claude_code / codex / cursor / gemini / opencode are never seeded)
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
  Scenario: User sees only non-coding-assistant templates on /me Trace Ingest
    When jane navigates to "/me" and scrolls to the "Trace Ingest" section
    Then she sees a tile-grid with exactly these items:
      | tile slug         | label                   | source                      |
      | claude_cowork     | "Connect Claude cowork" | api.ingestionTemplates.list |
      | raw_otlp_advanced | "Raw OTLP (advanced)"   | client-side discovery card  |
    And the install tile is sourced from `api.ingestionTemplates.list`
    And the raw_otlp_advanced card is rendered client-side (no server query)
    And NO tile is shown for claude_code, codex, cursor, gemini, or opencode
        (those are coding-assistant tiles on the AiToolsPortal, not ingestion templates)
    And the raw_otlp_advanced card is visually distinct from the install tiles
        (e.g. dashed border + subtle background per Lane-B Iter 2)

  @bdd @ingestion-templates @catalog @coding-assistant-not-a-template
  Scenario: A platform coding assistant never appears as an ingestion template
    Given the coding assistant "opencode" is set up by `langwatch opencode`
    When jane navigates to "/me" Trace Ingest
    Then she does NOT see an "opencode" install tile in the Trace Ingest grid
    And opencode appears instead as a coding-assistant tile in the AiToolsPortal
        with setup command "$ langwatch opencode"
    # Option B: opencode is a platform coding assistant, so it is not seeded as
    # an ingestion template — same as claude_code / codex / cursor / gemini.

  @bdd @ingestion-templates @catalog @copy-disambiguation
  Scenario: Catalog copy distinguishes auto-shape vs raw OTLP
    When jane opens the install drawer for the claude_cowork tile
    Then the drawer headline reads "Connect Claude cowork — auto-shaped"
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
    Then she sees the same non-coding-assistant tiles as jane (claude_cowork + raw_otlp_advanced)

  @bdd @ingestion-templates @catalog @cross-org-isolation
  Scenario: Org-authored templates (organizationId NOT NULL) are scoped to that org only
    Given an IngestionTemplate row exists with slug "acme-internal-router" and organizationId="acme"
    When jane navigates to /me Trace Ingest
    Then she sees "acme-internal-router" alongside the platform defaults
    But when lisa from "beta-corp" navigates to her /me Trace Ingest
    Then she does NOT see "acme-internal-router"
    # Org-authoring UI deferred to v2; the organizationId-NULL-vs-NOT-NULL scope
    # column is reserved v1 so cross-org isolation is correct from day one.

  # ---------------------------------------------------------------------------
  # Admin catalog surface — READ-ONLY v1
  # ---------------------------------------------------------------------------

  @bdd @ingestion-templates @admin-readonly
  Scenario: Admin sees only non-coding-assistant templates as READ-ONLY in tool-catalog
    Given admin "carol@acme.com" has the `ingestionTemplate:view` permission
    When carol navigates to "/settings/governance/tool-catalog" and selects the "Ingestion Templates" tab
    # Existing P7-B6 ToolCatalogEditor surface (AiToolEntry catalog) gets a
    # second tab here. No new admin route v1.
    Then she sees the platform-default IngestionTemplate rows listed
        (claude_cowork only — raw_otlp_advanced is a client-side card and does
        NOT appear in the admin templates table)
    And she does NOT see rows for claude_code, codex, cursor, gemini, or opencode
        (they were never seeded as templates, so there is nothing to filter)
    And each template row has a "View OTTL" affordance opening a read-only modal
    But there is NO "Edit" button, NO "Disable" button, and NO "Fork" button v1
    And the page footer reads "Need a custom template? Request via [docs link]."
    # Admin OTTL authoring UI + per-org override-to-disable both defer to v2.

  # ---------------------------------------------------------------------------
  # Regression / no-leak invariants
  # ---------------------------------------------------------------------------

  @bdd @ingestion-templates @catalog @no-coding-assistant-seed @regression
  Scenario: The platform-template seed produces no coding-assistant rows
    When the platform IngestionTemplate seed runs
    Then no seeded row has a slug of claude_code, codex, cursor, gemini, or opencode
    And claude_cowork is the only platform coding-tool template seeded
    # No flag, no filter constant: the coding assistants are absent from the seed
    # input itself, so the /me grid and the admin list never have a row to drop.

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
