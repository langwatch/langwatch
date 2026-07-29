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
    Given a brand-new organization whose catalog has never had a single entry

  @integration
  Scenario: A fresh organization gets the full standard catalog with no admin action
    When the standard tools are provisioned for the organization
    Then the organization's catalog shows all 8 standard tiles
    And each tile is available to the whole organization and enabled
    And each tile matches its starter-pack original, so a later
        starter-pack import recognises it instead of duplicating it
    And no admin performed any catalog action

  @integration
  Scenario: Default catalog provisioning is idempotent across repeated calls
    Given the organization already received the standard catalog
    When provisioning runs again for the organization
    Then no new tiles appear and the catalog still has exactly 8 tiles

  @integration
  Scenario: An organization whose admin archived or disabled every entry is not re-seeded
    Given the organization's admin archived or disabled every catalog entry
    When provisioning runs for the organization
    Then no tiles are added
    And the admin's curated-empty catalog is preserved
    # This is what keeps the portal empty state meaningful: it can only
    # ever be the result of deliberate admin curation, never a fresh org.

  @integration
  Scenario: Concurrent provisioning attempts create exactly one catalog
    When two provisioning attempts race for the same organization
    Then the catalog ends with exactly 8 tiles and no duplicates
    # There is no unique constraint on (organizationId, slug); a
    # transaction-scoped per-org advisory lock serialises provisioners.

  @integration
  Scenario: A member's first portal load of a zero-row organization returns the provisioned catalog
    Given a MEMBER of the brand-new organization
    When the member opens their /me portal for the first time
    Then the portal shows the 8 standard tiles, all enabled
    And the member sees tile sections, never the empty state

  @unit
  Scenario: The platform default template set ships no claude-cowork
    When the platform's built-in template set is inspected
    Then it offers no templates at all
    And "claude_cowork" is marked as retired

  @integration
  Scenario: An existing platform claude-cowork template is archived by the seeder
    Given a platform-published "claude_cowork" template left over from an earlier release
    When the platform template catalog is synced
    Then every platform copy of the claude-cowork template is archived and disabled
    And no new platform templates appear
    And tools already connected through claude-cowork keep ingesting unaffected
