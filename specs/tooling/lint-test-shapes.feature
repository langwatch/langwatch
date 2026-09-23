# ADR-142 once kept its ast-grep test shapes here; ast-grep was removed on
# 2026-09-23. `no-tautological-assertion` and `no-form-watch-in-child` are
# plugin rules with their own lint-<name>.feature. `vitest/expect-expect` still
# runs at oxlint's default "warn", which `--quiet` hides, so it is advisory.

Feature: The assertion-coverage built-in stays at its default
  As a platform maintainer
  I want the state of vitest/expect-expect recorded honestly
  So that an advisory rule is not read as an enforced one

  Rule: `vitest/expect-expect` refuses a test body with no expect, or an empty one, advisory-only under --quiet

    @unit
    Scenario: The assertion-coverage rule carries no explicit config line
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in vitest/expect-expect rule is not explicitly configured
