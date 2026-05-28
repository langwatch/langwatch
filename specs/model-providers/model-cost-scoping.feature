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
  Scenario: Listing custom costs without an organization predicate throws
    When CustomLLMModelCost.findMany is called with an empty WHERE
    Then the tenancy guard throws because no organizationId or row id was supplied

  @integration @unimplemented
  Scenario: A custom cost row is created with its owning organization
    When a custom cost is created without an organizationId
    Then the tenancy guard throws because the row must declare its owning organization

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

  # ────────────────────────────────────────────────────────────────────────────
  # Migration
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Existing project-only custom costs migrate to a project-tier scope
    Given a legacy custom cost stored against project "web-app" before the migration
    When the migration runs
    Then the row carries organization "acme" as its anchor
    And the row carries a PROJECT-tier scope pointing at "web-app"
    And resolving the cost for "web-app" returns the same value as before the migration
