Feature: AI Tools Portal — org/team scoping resolution
  As a portal that supports org-defaults with per-team overrides
  I want list-for-user to apply Vercel-style team-overrides-org by slug
  So that admins can hide or re-skin a globally-listed tool for a specific team

  Background:
    Given organization "acme" with the portal feature flag on
    And team "platform" exists in "acme"
    And team "data-science" exists in "acme"
    And alice is a member of "platform"
    And bob is a member of "data-science"
    And carol is a member of NO team in "acme"

  @bdd @phase-7 @scoping @read
  Scenario: Org-scoped entries are visible to all org members
    Given an organization-scoped entry exists with slug="claude-code", displayName="Claude Code"
    When alice / bob / carol call `aiTools.list({ organizationId: "acme" })`
    Then each user sees the "Claude Code" entry exactly once

  @bdd @phase-7 @scoping @read
  Scenario: Team-scoped entries are filtered to that team's members
    Given an organization-scoped entry "claude-code" exists
    And a team-scoped entry exists with slug="bedrock", scopeId="platform"
    When alice (platform member) calls `aiTools.list({ organizationId: "acme" })`
    Then alice sees both "claude-code" AND "bedrock"
    When bob (data-science member, NOT platform) calls `aiTools.list({ organizationId: "acme" })`
    Then bob sees ONLY "claude-code" (not "bedrock")
    When carol (no team) calls `aiTools.list({ organizationId: "acme" })`
    Then carol sees ONLY "claude-code"

  @bdd @phase-7 @scoping @overrides
  Scenario: Team-scoped entry with same slug overrides org-default for team members
    Given an organization-scoped entry exists with slug="openai", displayName="OpenAI (default)"
    And a team-scoped entry exists with slug="openai", scopeId="platform", displayName="OpenAI — Platform team policy"
    When alice (platform member) calls `aiTools.list`
    Then alice sees ONLY the team entry "OpenAI — Platform team policy"
    When bob (data-science member) calls `aiTools.list`
    Then bob sees ONLY the org default "OpenAI (default)"

  @bdd @phase-7 @scoping @disabled
  Scenario: Disabled entries are hidden from user-facing list, visible to admin
    Given an organization-scoped entry "copilot" is disabled (enabled=false)
    When bob calls `aiTools.list({ organizationId: "acme" })`
    Then "copilot" is NOT in bob's response
    When alice (admin) calls `aiTools.adminList({ organizationId: "acme" })`
    Then "copilot" IS in alice's adminList response with enabled=false

  @bdd @phase-7 @scoping @archived
  Scenario: Archived entries are hidden from both lists
    Given an entry "deprecated-tool" was archived (archivedAt set)
    When bob calls `aiTools.list`
    Then "deprecated-tool" is NOT in bob's response
    When alice calls `aiTools.adminList`
    Then "deprecated-tool" IS still in alice's adminList (audit-trail preservation)

  @bdd @phase-7 @scoping @ordering
  Scenario: list-for-user respects admin-curated order
    Given 3 org-scoped entries exist with order=2, order=0, order=1
    When bob calls `aiTools.list`
    Then the entries are returned sorted by (order ASC, displayName ASC)
