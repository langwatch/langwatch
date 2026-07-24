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
  # data is kept for the platform default (49 days / 7 weeks) — retention is
  # default-on, so absence of an override is NOT indefinite retention.
  # Categories resolve independently, so a project can keep traces for 91 days
  # while scenarios inherit the team rule and experiments inherit the
  # organization rule.
  #
  # Retention is set in whole weeks (multiples of 7 days), because every
  # retention-managed table is partitioned weekly (toYearWeek).

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app" under that team

  Scenario: A project with no override resolves to the platform default
    Given no retention override exists for the organization, the team, or the project
    When retention is resolved for project "web-app"
    Then every category resolves to the platform default of 49 days

  Scenario: An organization override applies to every project in the org
    Given an organization-level traces retention of 49 days for "acme"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 49 days

  Scenario: A project override beats an organization override
    Given an organization-level traces retention of 49 days for "acme"
    And a project-level traces retention of 91 days for "web-app"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 91 days

  Scenario: A team override sits between organization and project
    Given an organization-level traces retention of 49 days for "acme"
    And a team-level traces retention of 63 days for "platform"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 63 days

  Scenario: Categories resolve independently across tiers
    Given a project-level traces retention of 91 days for "web-app"
    And a team-level scenarios retention of 63 days for "platform"
    And an organization-level experiments retention of 49 days for "acme"
    When retention is resolved for project "web-app"
    Then traces for "web-app" are kept for 91 days
    And scenarios for "web-app" are kept for 63 days
    And experiments for "web-app" are kept for 49 days

  Scenario: Minimum retention enforced at 49 days
    When an admin attempts to set traces retention to 14 days at any scope
    Then the request is rejected with a validation error
    And the error indicates the minimum retention is 49 days

  Scenario: Retention must be a whole number of weeks
    When an admin attempts to set traces retention to 50 days at any scope
    Then the request is rejected with a validation error
    And the error indicates retention must be a multiple of 7 days

  Scenario: Removing a project override falls back to the next tier
    Given an organization-level traces retention of 63 days for "acme"
    And a project-level traces retention of 91 days for "web-app"
    When the project admin removes the project-level traces override
    Then traces for "web-app" are kept for 63 days from the organization rule

  # The settings table exposes per-rule actions through a single overflow menu
  # (the established row-actions pattern), so a customer can change a value
  # without deleting and re-creating the rule.

  Scenario: Editing a policy from the row overflow menu changes only its value
    Given a project-level traces retention of 91 days for "web-app"
    When the project admin edits that policy from the row menu and sets 182 days
    Then the policy's scope stays "web-app"
    And traces for "web-app" are kept for 182 days

  # Removal is a deliberate, explained action. Deleting a rule never deletes
  # data — it only changes the retention applied to newly ingested data, which
  # falls back to the next applicable tier (or the platform default).

  Scenario: Removal asks for confirmation and previews the real fallback value
    Given an organization-level traces retention of 49 days for "acme"
    And a project-level traces retention of 91 days for "web-app"
    When the project admin chooses to remove the project-level policy
    Then a confirmation explains that existing data is not deleted
    And it shows the retention falling back from 91 days to 49 days
    And the policy is removed only after the admin confirms

  Scenario: The previewed fallback never leaks a rule the caller cannot read
    Given a project-level traces retention of 91 days for "web-app"
    And an organization-level traces retention the caller is not allowed to read
    When the caller previews removal of the project-level policy
    Then the response contains only the resolved day count, not the org rule's scope

  Scenario: A project admin cannot set an organization-wide override
    Given a user who can manage project "web-app" but not the organization
    When that user attempts to set an organization-level traces retention
    Then the request is rejected as forbidden

  # The Data Storage figure tracks the page's scope selector. A single project
  # only ever shows that project; widening to the team or organization sums the
  # storage of every project in that scope the caller is allowed to read.

  Scenario: Storage for an organization scope sums its projects
    Given the organization "acme" has projects "web-app" using 19 GB and "worker" using 0 B
    And the caller can read both projects
    When storage is shown with the organization scope selected
    Then the Data Storage figure is the sum of both projects

  Scenario: Storage never counts a project the caller cannot read
    Given the organization "acme" has a project the caller cannot read
    When storage is shown with the organization scope selected
    Then that project's storage is excluded from the total

  Scenario: An override is anchored to a single organization
    When an admin sets a team-level traces retention for "platform"
    Then the override is anchored to the organization that owns "platform"
    And it can never apply to a project in another organization

  # "No retention" (keep data indefinitely, exempt from TTL deletion) is a
  # platform-level capability, not a customer-configurable tier. Only a platform
  # administrator — an email in the ADMIN_EMAILS allow-list, which is distinct
  # from an organization admin — may set it, on a scope they can already write.

  Scenario: A platform admin can disable retention for a scope
    Given a platform administrator
    When that administrator sets retention to "no retention" for project "web-app"
    Then the override is accepted
    And data for "web-app" is kept indefinitely with no automatic deletion

  Scenario: An organization admin who is not a platform admin cannot disable retention
    Given a user who can manage the organization but is not a platform administrator
    When that user attempts to set retention to "no retention" at any scope
    Then the request is rejected as forbidden
    And the error indicates only platform administrators can disable retention

  Scenario: The "no retention" option is hidden from non-platform-admins
    Given a user who is not a platform administrator
    When they open the add-retention-policy drawer
    Then the retention options do not include "no retention"
