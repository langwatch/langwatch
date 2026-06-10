Feature: Data privacy policy configuration
  As an organization admin
  I want to control what trace content is stored, who can see it, and how
  secrets and PII are scrubbed, at the organization, department, team, or
  project level
  So that I can enforce one privacy posture across many projects without
  re-entering it in every project

  # Data privacy is a scoped resource (ADR-021): a rule is set at one scope
  # (organization, department, team, or project, optionally narrowed to
  # "personal projects only"), and a project resolves the most-specific rule
  # that applies to it. The cascade walks PROJECT -> DEPARTMENT -> TEAM ->
  # ORGANIZATION (a department rule beats a team rule, the people lens beating
  # the structural one). Each setting resolves independently, so a project can
  # drop its input while inheriting the organization's PII level. With no rule
  # anywhere in the chain, the platform defaults apply: content is captured and
  # visible to the whole team, PII is redacted at the essential level, and
  # secrets are redacted. Privacy is therefore default-on for secrets and PII.

  Background:
    Given an organization "acme" with a department "hr", a team "platform", and a project "web-app" under that team

  @unit
  Scenario: A project with no rule resolves to the platform defaults
    Given no privacy rule exists for the organization, department, team, or project
    When the privacy policy is resolved for project "web-app"
    Then trace input and output are captured and visible to the whole team
    And PII is redacted at the essential level
    And secrets are redacted

  @unit
  Scenario: An organization rule applies to every project in the org
    Given an organization rule that drops trace input
    When the privacy policy is resolved for project "web-app"
    Then trace input is dropped for "web-app"

  @unit
  Scenario: A project rule beats an organization rule
    Given an organization rule that drops trace input
    And a project rule on "web-app" that captures trace input
    When the privacy policy is resolved for project "web-app"
    Then trace input is captured for "web-app"

  @unit
  Scenario: A team rule sits between organization and project
    Given an organization rule that captures trace input
    And a team rule on "platform" that drops trace input
    When the privacy policy is resolved for project "web-app"
    Then trace input is dropped for "web-app"

  @unit
  Scenario: A department rule applies to projects assigned to that department
    Given project "web-app" is assigned to the "hr" department
    And a department rule on "hr" that restricts trace output to admins
    When the privacy policy is resolved for project "web-app"
    Then trace output is visible only to admins for "web-app"

  @unit
  Scenario: A department rule beats a team rule for the same project
    Given project "web-app" is assigned to the "hr" department
    And a team rule on "platform" that captures trace output
    And a department rule on "hr" that drops trace output
    When the privacy policy is resolved for project "web-app"
    Then trace output is dropped for "web-app"

  @unit
  Scenario: Settings resolve independently across tiers
    Given an organization rule that sets strict PII redaction
    And a team rule on "platform" that drops trace input
    And a project rule on "web-app" that restricts trace output to admins
    When the privacy policy is resolved for project "web-app"
    Then trace input is dropped for "web-app"
    And trace output is visible only to admins for "web-app"
    And PII is redacted at the strict level for "web-app"

  # Personal projects are every user's private CLI workspace. An admin can write
  # one rule that covers all of them without touching each project, and can
  # narrow it to the personal projects of people in a given department.

  @unit
  Scenario: A rule for all personal projects covers a personal workspace but not a team project
    Given a personal project "alice-workspace" owned by a member of "acme"
    And an organization rule narrowed to personal projects only that drops trace input
    When the privacy policy is resolved for project "alice-workspace"
    Then trace input is dropped for "alice-workspace"
    When the privacy policy is resolved for project "web-app"
    Then trace input is captured for "web-app"

  @unit
  Scenario: A department rule narrowed to personal projects follows the owner's department
    Given a member of "acme" who belongs to the "hr" department
    And a personal project "bob-workspace" owned by that member
    And a department rule on "hr" narrowed to personal projects only that drops trace input
    When the privacy policy is resolved for project "bob-workspace"
    Then trace input is dropped for "bob-workspace"

  @unit
  Scenario: Extra keys to drop accumulate down the cascade
    Given an organization rule that also drops the attribute "http.request.body"
    And a project rule on "web-app" that also drops the attribute "app.session_token"
    When the privacy policy is resolved for project "web-app"
    Then both "http.request.body" and "app.session_token" are dropped for "web-app"

  @integration
  Scenario: A rule is anchored to a single organization
    When an admin sets a team rule for "platform"
    Then the rule is anchored to the organization that owns "platform"
    And it can never apply to a project in another organization

  @integration
  Scenario: A project admin cannot set an organization-wide rule
    Given a user who can manage project "web-app" but not the organization
    When that user attempts to set an organization-level privacy rule
    Then the request is rejected as forbidden

  @integration
  Scenario: Removing a project rule falls back to the next tier
    Given an organization rule that drops trace input
    And a project rule on "web-app" that captures trace input
    When the project admin removes the project-level rule
    Then trace input is dropped for "web-app" from the organization rule
