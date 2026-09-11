Feature: The oxlint baseline replaces the hand-written per-file registers
  Debt for cognitive-complexity, condition-shape, max-depth and complexity
  used to live as ~2,400 hand-edited filenames spread across oxlint config
  overrides, with no mechanical shrink-only check. It now lives in one file,
  packages/architecture-enforcer/src/oxlint-baseline.json, keyed `rule|file` with
  a `measured` date. A `defineRule` plugin rule (cognitive-complexity,
  condition-shape) consults it directly and reports nothing for a baselined
  file; the two native rules that cannot read it (max-depth, complexity)
  still need a config override, but that override is generated from the same
  baseline file by generate-native-baseline-overrides.mjs rather than
  hand-maintained. `langwatch/nested-ternary` used to be a third plugin rule
  here, written only so it could read the baseline in place of the built-in
  `no-nested-ternary`; ADR-135/ADR-140's class-A migration deleted it and
  enabled the built-in directly, so the 342 entries it used to read are now
  unconsulted by anything.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A baselined file reports nothing
    Given a file baselined for a rule it would otherwise fail
    When that rule runs over the file
    Then it reports nothing

  Rule: `no-nested-ternary` is the built-in that replaced the baseline-reading plugin rule

    @unit
    Scenario: The nested ternary rule is enabled workspace-wide
      Given the oxlint configuration
      When its workspace-wide rules are read
      Then the built-in no-nested-ternary rule is enabled

  Rule: `oxlint` holds the ledger to a shrink-only ratchet

  @unit
  Scenario: The oxlint baseline is shrink-only and every entry carries a measured date
    Given the current oxlint baseline and a merge-base reference baseline
    When the baseline is checked against the reference
    Then a current entry not present in the reference is rejected
    And an entry with no measured date is rejected regardless of a reference
    And an absent baseline file passes
