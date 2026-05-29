Feature: Data retention policy configuration
  As a paid customer
  I want to configure how long my observability data is kept, at the
  organization, team, or project level
  So that I can manage storage costs and comply with data governance policies
  without re-entering the same rule in every project

  # Retention is a scoped resource (ADR-021): an override is set for one
  # category at one scope (organization, team, or project), and a project
  # resolves the most-specific override that applies to it, walking
  # PROJECT -> TEAM -> ORGANIZATION. With no override anywhere in that chain,
  # data is kept indefinitely. Categories resolve independently, so a project
  # can keep traces for 90 days while scenarios inherit the team rule and
  # experiments inherit the organization rule.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app" under that team

  Scenario: A project with no override keeps data indefinitely
    Given no retention override exists for the organization, the team, or the project
    When retention is resolved for project "web-app"
    Then every category is kept indefinitely

  Scenario: An organization override applies to every project in the org
    Given an organization-level traces retention of 30 days for "acme"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 30 days

  Scenario: A project override beats an organization override
    Given an organization-level traces retention of 30 days for "acme"
    And a project-level traces retention of 90 days for "web-app"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 90 days

  Scenario: A team override sits between organization and project
    Given an organization-level traces retention of 30 days for "acme"
    And a team-level traces retention of 60 days for "platform"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 60 days

  Scenario: Categories resolve independently across tiers
    Given a project-level traces retention of 90 days for "web-app"
    And a team-level scenarios retention of 60 days for "platform"
    And an organization-level experiments retention of 30 days for "acme"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 90 days
    And scenarios for "web-app" are kept for 60 days
    And experiments for "web-app" are kept for 30 days

  Scenario: Minimum retention enforced at 30 days
    When an admin attempts to set traces retention to 15 days at any scope
    Then the request is rejected with a validation error
    And the error indicates the minimum retention is 30 days

  Scenario: Removing a project override falls back to the next tier
    Given an organization-level traces retention of 60 days for "acme"
    And a project-level traces retention of 90 days for "web-app"
    When the project admin removes the project-level traces override
    Then traces for "web-app" are kept for 60 days from the organization rule

  Scenario: A project admin cannot set an organization-wide override
    Given a user who can manage project "web-app" but not the organization
    When that user attempts to set an organization-level traces retention
    Then the request is rejected as forbidden

  Scenario: An override is anchored to a single organization
    When an admin sets a team-level traces retention for "platform"
    Then the override is anchored to the organization that owns "platform"
    And it can never apply to a project in another organization
