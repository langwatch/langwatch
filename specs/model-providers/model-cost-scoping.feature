Feature: Multi-scope model cost overrides
  As an organization admin
  I want to set custom model costs once at the organization level
  And let teams or projects override them where they need to
  So that I don't re-enter the same pricing in every project, and a project
  always resolves the most specific cost that applies to it

  # Background
  #
  # Today CustomLLMModelCost is project-only: a custom cost can be set for
  # exactly one project, platform defaults come from a global llmModels.json,
  # and there is no organization-level or team-level override. Every project
  # that wants a non-default price re-enters it.
  #
  # ADR-021 makes model costs a single-scope-per-row inline resource: each
  # CustomLLMModelCost row carries an organizationId anchor plus an inline
  # (scopeType, scopeId). Resolution walks the cascade
  # PROJECT -> TEAM -> ORGANIZATION -> static llmModels.json default and
  # returns the most specific hit. The platform defaults are the
  # organization-level baseline.
  #
  # Existing project-only rows migrate to a PROJECT-tier inline scope, so no
  # current behavior changes for a project that already had a custom cost.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app" under that team
    And the model "openai/gpt-5-mini" has a static default cost from the platform price list

  # ────────────────────────────────────────────────────────────────────────────
  # Resolution cascade
  # ────────────────────────────────────────────────────────────────────────────

  @unit @unimplemented
  Scenario: A project with no override resolves the static platform default
    When the cost for "openai/gpt-5-mini" is resolved for project "web-app"
    Then the static platform default cost is returned
    And the source is reported as the platform default

  @unit @unimplemented
  Scenario: An organization-level override applies to every project in the org
    Given "acme" has an organization-level custom cost for "openai/gpt-5-mini"
    When the cost for "openai/gpt-5-mini" is resolved for project "web-app"
    Then the organization-level custom cost is returned
    # The org cost was previously ignored because resolution only looked at
    # the project's own rows; the cascade now reaches the org tier.

  @unit @unimplemented
  Scenario: A project override beats an organization override
    Given "acme" has an organization-level custom cost for "openai/gpt-5-mini"
    And project "web-app" has a project-level custom cost for "openai/gpt-5-mini"
    When the cost for "openai/gpt-5-mini" is resolved for project "web-app"
    Then the project-level custom cost is returned

  @unit @unimplemented
  Scenario: A team override sits between organization and project
    Given "acme" has an organization-level custom cost for "openai/gpt-5-mini"
    And team "platform" has a team-level custom cost for "openai/gpt-5-mini"
    When the cost for "openai/gpt-5-mini" is resolved for project "web-app"
    Then the team-level custom cost is returned

  # ────────────────────────────────────────────────────────────────────────────
  # Tenancy
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A custom cost from another organization never resolves for this org
    Given another organization "globex" has an organization-level custom cost for "openai/gpt-5-mini"
    When the cost for "openai/gpt-5-mini" is resolved for project "web-app" in "acme"
    Then the globex custom cost is not considered
    And the static platform default cost is returned

  @integration @unimplemented
  Scenario: One organization only sees its own custom costs
    Given "acme" and "globex" each have custom costs
    When a member of "acme" views the custom costs
    Then only "acme" custom costs are shown
    And no "globex" custom cost is ever returned
    # Every custom-cost read is constrained to the caller's organization at
    # the data layer; an unconstrained read is rejected.

  @integration @unimplemented
  Scenario: A custom cost always belongs to one organization
    When a custom cost is saved
    Then it is recorded against exactly one owning organization
    # A save that fails to declare its owning organization is rejected.

  # ────────────────────────────────────────────────────────────────────────────
  # Authorization per scope
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Setting an organization-level cost requires organization manage permission
    Given a caller who can update project "web-app" but cannot manage organization "acme"
    When the caller tries to set an organization-level custom cost
    Then the write is forbidden

  @integration @unimplemented
  Scenario: Setting a project-level cost requires project update permission
    Given a caller who can update project "web-app"
    When the caller sets a project-level custom cost for "web-app"
    Then the write succeeds

  @integration
  Scenario: createOrUpdate rejects re-anchoring a cost row the caller does not own
    Given an existing project-level cost row owned by organization "acme"
    And a caller who manages a project in a different organization
    When the caller calls createOrUpdate with that row's id but their own scope
    Then the write is forbidden
    And the row keeps its original organization, scope, and model

  @integration
  Scenario: createOrUpdate updates a cost row when the caller manages its current scope
    Given an existing project-level cost row in the caller's organization
    And a caller who manages that project
    When the caller calls createOrUpdate with the row's id and scope
    Then the write succeeds

  # ────────────────────────────────────────────────────────────────────────────
  # Migration
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: An existing project custom cost keeps resolving after the migration
    Given a legacy custom cost set for project "web-app" before the migration
    When the migration runs
    Then resolving the cost for "web-app" returns the same value as before
    And that cost still applies only within "acme"
    And it stays a project-level override, not an organization-wide one
    # The legacy row gains its owning organization and a project-tier scope.
