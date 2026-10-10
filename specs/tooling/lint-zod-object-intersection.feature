@adr-139
Feature: Zod objects compose into one object, not an intersection
  An intersection of two Zod objects parses the input once per side and merges
  the results, and types as `A & B`. One object built from both shapes parses
  once through Zod's compiled object path and types as a fresh object.

  Rule: `zod-object-intersection` reports `.and()` and `z.intersection()` when
    both sides resolve to Zod objects

  @unit
  Scenario: Two plain objects intersected are reported with the shape spread
    Given a production file intersects two statically resolved Zod objects
    When lint runs
    Then zod-object-intersection names `z.object({ ...left.shape, ...right.shape })`
    And it names `left.safeExtend(right.shape)` for strict or catchall objects

  @unit
  Scenario: A refined left side keeps its refinements
    Given the left side of the intersection carries a refinement
    When lint runs
    Then zod-object-intersection directs the reader to `left.safeExtend(right.shape)`

  @unit
  Scenario: An intersection that cannot become one object is left alone
    Given one side is a record, a union, a refined right side or an unresolved schema
    When lint runs
    Then zod-object-intersection reports nothing

  @unit
  Scenario: Tests and generated files are excluded from the intersection check
    Given the intersection sits in a test or a generated file
    When lint runs
    Then zod-object-intersection reports nothing
