Feature: The oxlint baseline replaces the hand-written per-file registers
  Debt for cognitive-complexity, condition-shape, nested-ternary, max-depth
  and complexity used to live as ~2,400 hand-edited filenames spread across
  oxlint config overrides, with no mechanical shrink-only check. It now lives
  in one file, packages/architecture-lint/src/oxlint-baseline.json, keyed
  `rule|file` with a `measured` date. A `defineRule` plugin rule
  (cognitive-complexity, condition-shape, the new langwatch/nested-ternary)
  consults it directly and reports nothing for a baselined file; the two
  native rules that cannot read it (max-depth, complexity) still need a
  config override, but that override is generated from the same baseline
  file by generate-native-baseline-overrides.mjs rather than hand-maintained.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: A baselined file reports nothing
    Given a file baselined for a rule it would otherwise fail
    When that rule runs over the file
    Then it reports nothing

  @unit
  Scenario: A nested ternary is reported on the inner ternary
    Given a ternary whose consequent or alternate is itself a ternary
    When the nested-ternary rule runs over it
    Then it reports nested on the inner ternary with the branch's position

  @unit
  Scenario: A ternary with no nested branch is left alone
    Given a ternary whose branches are not ternaries
    When the nested-ternary rule runs over it
    Then it reports nothing

  @unit
  Scenario: The oxlint baseline is shrink-only and every entry carries a measured date
    Given the current oxlint baseline and a merge-base reference baseline
    When the baseline is checked against the reference
    Then a current entry not present in the reference is rejected
    And an entry with no measured date is rejected regardless of a reference
    And an absent baseline file passes
