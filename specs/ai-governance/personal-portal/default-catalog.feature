Feature: AI Tools Portal - Default catalog provisioning
  As a brand-new organization signing up to LangWatch
  I want the standard set of AI tools provisioned for me automatically
  So that my members' /me portal renders useful tiles on its very first
  load instead of an "Add your first tools" empty state

    Provisioning is zero-touch and strictly conservative: it only ever
    acts on an organization that has NEVER had any AiToolEntry row.
    Enabled, disabled, and archived rows all count as rows, so a catalog
    an admin curated down to nothing stays empty. The portal empty state
    remains reachable only as that curated-empty fallback (see
    portal-grid.feature).

    The standard set is the starter pack: 4 coding assistants
    (Claude Code, Codex, Gemini CLI, opencode) and 4 model providers
    (OpenAI, Anthropic, AWS Bedrock, Google AI), all org-scoped and
    enabled, with slugs written verbatim so a later admin starter-pack
    import recognises them instead of duplicating.

    Two triggers, one guarantee:
      - onboarding initializeOrganization provisions at org creation for
        every signup intent (non-fatal: a provisioning failure never
        costs the user their new organization)
      - the aiTools.list read path provisions lazily before listing, so
        even an org created before this behavior (or after an onboarding
        hiccup) gets the catalog on its first portal load

  Background:
    Given a brand-new organization with zero AiToolEntry rows

  @integration
  Scenario: A fresh organization gets the full standard catalog with no admin action
    When the default catalog is ensured for the organization
    Then all 8 standard tiles exist on the organization's catalog
    And each tile is org-scoped and enabled
    And each tile carries the starter pack's verbatim slug, icon, and config
    And no admin performed any catalog action

  @integration
  Scenario: Default catalog provisioning is idempotent across repeated calls
    Given the default catalog was already ensured for the organization
    When the default catalog is ensured again
    Then no new rows are created and the catalog still has exactly 8 tiles

  @integration
  Scenario: An organization whose admin archived or disabled every entry is not re-seeded
    Given the organization has only archived or disabled AiToolEntry rows
    When the default catalog is ensured for the organization
    Then no rows are created
    And the admin's curated-empty catalog is preserved
    # This is what keeps the portal empty state meaningful: it can only
    # ever be the result of deliberate admin curation, never a fresh org.

  @integration
  Scenario: Concurrent provisioning attempts create exactly one catalog
    When two provisioning calls race for the same organization
    Then exactly one call seeds and the catalog ends with exactly 8 tiles
    # There is no unique constraint on (organizationId, slug); a
    # transaction-scoped per-org advisory lock serialises provisioners.

  @integration
  Scenario: A member's first portal load of a zero-row organization returns the provisioned catalog
    Given a MEMBER of the brand-new organization
    When the member's client calls aiTools.list for the first time
    Then the list returns the 8 standard tiles, all enabled
    And the /me portal therefore renders tile sections, never the empty state

  @unit
  Scenario: The platform default template set ships no claude-cowork
    When the platform IngestionTemplate seed input is inspected
    Then it contains no template rows at all
    And "claude_cowork" is listed among the retired platform template slugs

  @integration
  Scenario: An existing platform claude-cowork template is archived by the seeder
    Given a platform-published IngestionTemplate row with slug "claude_cowork" exists
    When the platform IngestionTemplate seeder runs
    Then the claude-cowork row is archived and disabled
    And no new platform template rows are created
    And installed claude-cowork IngestionSources keep ingesting unaffected
