# ADR-141 once kept its ast-grep invariants here; ast-grep was removed on
# 2026-09-23 and each surviving rule has its own lint-<name>.feature. What
# remains is where `typescript/no-explicit-any` is enabled.

Feature: The explicit-any rule is scoped to source, not set workspace-wide
  As a platform maintainer
  I want `any` refused in source while a test double may stay loosely typed
  So that the rule reports where a fix is owed and nowhere else

  Rule: `typescript/no-explicit-any` is enabled by an override, not workspace-wide

    @unit
    Scenario: The explicit-any rule is not in the workspace-wide config
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in typescript/no-explicit-any rule is not present
