# ADR-135's class-A migration deleted the plugin rule `langwatch/runtime-undefined`
# and measured its built-in replacement, `no-undefined`, at 11,568 findings
# across 3,591 files. The built-in is measured and left disabled.

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
