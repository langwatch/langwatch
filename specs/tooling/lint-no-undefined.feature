# ADR-135's "Toolchain-owned policies" table used to carry
# `langwatch/runtime-undefined` as a plugin rule wired into no config.
# ADR-135's class-A migration deleted that plugin rule outright and measured
# its built-in replacement, `no-undefined`, at 11,568 findings across 3,591
# files -- a register that size is exactly the hand-written override the
# oxlint baseline mechanism exists to replace, and no-undefined has no
# baseline entries to re-key. The built-in is measured and left disabled.

Feature: The ambient-undefined built-in is measured and not adopted
  As a platform maintainer
  I want the retirement of langwatch/runtime-undefined recorded honestly
  So that "deleted the house rule" is not read as "enforced by the built-in"

  Rule: `no-undefined` was measured, not enabled

    @unit
    Scenario: The ambient-undefined rule is not in the workspace-wide config
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in no-undefined rule is not present
