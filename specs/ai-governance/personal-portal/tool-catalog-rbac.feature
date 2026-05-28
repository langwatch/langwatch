Feature: AI Tools Portal — RBAC enforcement
  As an organization with the AI Tools Portal feature enabled
  I want catalog reads + writes gated on resource-specific permissions
  So that members can discover available tools while only admins curate the list

  Background:
    Given organization "acme" with the portal feature flag on
    And alice is an org ADMIN of "acme"
    And bob is an org MEMBER of "acme"
    And mallory is an EXTERNAL (lite) member of "acme"
    And carol has no membership in "acme"

  @bdd @phase-7 @rbac @read
  Scenario: Org members can list visible tools (aiTools:view)
    Given the catalog has 2 enabled organization-scoped entries in "acme"
    When bob calls `aiTools.list({ organizationId: "acme" })`
    Then the response contains exactly the 2 enabled entries
    And the response status is 200

  @bdd @phase-7 @rbac @read
  Scenario: External (lite) members can also list (portal must work for everyone)
    Given the catalog has 1 enabled organization-scoped entry in "acme"
    When mallory calls `aiTools.list({ organizationId: "acme" })`
    Then the response contains the 1 enabled entry
    And the response status is 200

  @bdd @phase-7 @rbac @read
  Scenario: Non-members cannot list
    When carol calls `aiTools.list({ organizationId: "acme" })`
    Then the response is 401 UNAUTHORIZED
    And no entries are returned

  @bdd @phase-7 @rbac @write
  Scenario: Org members cannot create entries
    When bob calls `aiTools.create({ organizationId: "acme", scope: "organization", scopeId: "acme", type: "external_tool", displayName: "Internal wiki", slug: "wiki", config: { descriptionMarkdown: "Hi", linkUrl: "https://wiki.example.com" } })`
    Then the response is 401 UNAUTHORIZED
    And no entry is created

  @bdd @phase-7 @rbac @write
  Scenario: Org members cannot update or archive entries
    Given the catalog contains entry id "tile-123" in "acme"
    When bob calls `aiTools.update({ organizationId: "acme", id: "tile-123", displayName: "Renamed" })`
    Then the response is 401 UNAUTHORIZED
    When bob calls `aiTools.archive({ organizationId: "acme", id: "tile-123" })`
    Then the response is 401 UNAUTHORIZED

  @bdd @phase-7 @rbac @write
  Scenario: Org admins can create, update, archive, and reorder entries
    When alice calls `aiTools.create({ organizationId: "acme", scope: "organization", scopeId: "acme", type: "coding_assistant", displayName: "Claude Code", slug: "claude-code", config: { setupCommand: "langwatch claude", setupDocsUrl: "https://docs.langwatch.ai/claude" } })`
    Then a new entry is created
    And the response status is 200
    When alice calls `aiTools.adminList({ organizationId: "acme" })`
    Then the new entry is included in the response
    When alice calls `aiTools.archive({ organizationId: "acme", id: "<new-id>" })`
    Then the entry is soft-archived (archivedAt set, enabled=false)

  @bdd @phase-7 @rbac @custom-roles
  Scenario: Custom role grants aiTools:manage to a non-admin
    Given carol has a custom role binding granting "aiTools:manage" in "acme"
    When carol calls `aiTools.create(...)`
    Then the response status is 200
    And the entry is created
