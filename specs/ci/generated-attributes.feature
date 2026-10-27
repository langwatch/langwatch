Feature: Generated files carry linguist-generated
  As a reviewer
  I want every file a generator writes marked linguist-generated in .gitattributes
  So that GitHub collapses regenerated output and the impact map counts it as Generated

  The guard is .github/scripts/generated-attributes.test.ts. It lists each
  generator and the globs of the files it writes; .gitattributes is the one
  list the pr-impact-map workflow reads for its Generated category.

  @unit
  Scenario: Every tracked output of a known generator is marked generated
    Given a generator listed in the guard writes tracked files
    When the guard asks git for their linguist-generated attribute
    Then every one of them is "true"

  @unit
  Scenario: A listed output glob that matches no tracked file fails the guard
    Given a generator's output glob in the guard
    When no tracked file matches it
    Then the guard fails and names the stale glob

  @unit
  Scenario: A README carrying the readmegen block is marked generated
    Given a tracked README that opens a "readme:generated:start" block
    When the guard asks git for its linguist-generated attribute
    Then it is "true"

  @unit
  Scenario: A file named with the generated infix is marked generated
    Given a tracked file whose name contains ".generated."
    When the guard asks git for its linguist-generated attribute
    Then it is "true"
