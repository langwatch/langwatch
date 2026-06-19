Feature: Migrating the legacy privacy controls into the unified policy
  As the platform
  I want the previously separate privacy controls to become rules in the new
  scoped policy
  So that customers keep their exact privacy posture after the upgrade with no
  visible change

  # Three controls existed before the unified policy: the organization content
  # mode (which dropped gateway content), the project-level captured-input and
  # captured-output visibility, and the project PII level. Each is backfilled
  # into an equivalent privacy rule at its original scope so behavior is
  # preserved. After backfill the unified policy is the single source of truth.

  Background:
    Given an organization "acme" with a project "web-app"

  @integration
  Scenario: The organization content mode becomes an organization drop rule
    Given the organization previously had its content mode set to drop inputs and outputs
    When the privacy policy is backfilled
    Then an organization rule drops trace input and output for "acme"

  @integration
  Scenario: Admin-only captured input becomes a project restrict rule
    Given "web-app" previously had captured input visible to admins only
    When the privacy policy is backfilled
    Then a project rule on "web-app" restricts trace input to admins

  @integration
  Scenario: Fully-redacted captured output becomes a restrict-to-no-one rule
    Given "web-app" previously had captured output redacted to everyone
    When the privacy policy is backfilled
    Then a project rule on "web-app" restricts trace output to no one

  @integration
  Scenario: The project PII level is preserved
    Given "web-app" previously had its PII level set to strict
    When the privacy policy is backfilled
    Then the resolved PII level for "web-app" is strict

  @integration
  Scenario: A project with default legacy settings needs no rule
    Given "web-app" previously had all privacy controls at their defaults
    When the privacy policy is backfilled
    Then no privacy rule is created for "web-app"
    And the resolved policy for "web-app" matches the platform defaults
