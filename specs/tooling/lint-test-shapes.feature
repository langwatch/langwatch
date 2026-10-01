# ADR-142 once kept its ast-grep test shapes here; ast-grep was removed on
# 2026-09-23. `no-tautological-assertion` and `no-form-watch-in-child` are
# plugin rules with their own lint-<name>.feature. `vitest/expect-expect` runs at
# "error" through the correctness category, and names the helpers it trusts.

Feature: The assertion-coverage built-in counts named assertion helpers
  As a platform maintainer
  I want vitest/expect-expect to accept a test that asserts through a named helper
  So that a test is refused only when nothing in it can fail

  Rule: `vitest/expect-expect` refuses a test body that calls no `expect`, `expect*` or `assert*` function

    @unit
    Scenario: The assertion-coverage rule trusts expect and assert helpers
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then vitest/expect-expect is configured at error
      And its assertFunctionNames are "expect", "expect*" and "assert*"
