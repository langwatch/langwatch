# The R3 walk, ported from main's scripts/migrations/backfill-vk-config-to-rp.ts
# onto the task launcher. Migration 20260524163000_strip_vk_config_legacy_keys
# names that script by path and RAISEs on any leftover content, so an
# installation upgrading across it needs this to exist and to be runnable.

Feature: Virtual-key config backfill
  As an operator upgrading past the config split
  I want the legacy virtual-key config keys minted into their own rows
  So that the migration that strips them has nothing left to refuse

  @unit
  Scenario: The virtual-key config backfill mints the rows that replaced the legacy keys
    Given a virtual key carrying legacy model aliases and a pre-request guardrail
    And that key is scoped to a project and a team
    When the backfill runs and is told to execute
    Then one routing policy is minted at the same scope set as the key
    And one guardrail row is minted per referenced evaluator, with the legacy fail-open setting
    And the three legacy keys are stripped from the key's configuration
    And everything else in that configuration is left untouched

  @unit
  Scenario: The virtual-key config backfill refuses to guess a project for a guardrail
    Given a virtual key carrying guardrails but scoped to a team only
    When the backfill runs
    Then no guardrail row is minted, because guardrails are project-scoped
    And the key is reported as skipped rather than silently anchored somewhere

  @unit
  Scenario: The virtual-key config backfill is safe to re-run
    Given a virtual key that already carries none of the legacy keys
    When the backfill runs again
    Then that key is not touched at all
