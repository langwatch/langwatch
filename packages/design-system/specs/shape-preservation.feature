Feature: Shapes keep what the screens they replace already do
  As someone moving a screen onto a design-system shape
  I want the shape to carry the behaviour the screen already has
  So that a migration changes consistency and never what a reader can do
  Rulings: .claude/tmp/ds-sweep/plan/ROLLOUT.md (rulings 2026-10-11)

  @integration
  Scenario: A pager for a source that cannot count steps without fake totals
    Given a pager given only whether more pages exist
    Then it shows Back, the current page number and Next, and no numbered jumps or total
    And Next waits while the source has nothing more
    And Back waits on the first page
    And the range shows only when the rows on the page are given

  @integration
  Scenario: A pager for a source that can count keeps its numbered pages
    Given a pager given a total count
    Then it still offers numbered pages and the total

  @integration
  Scenario: A pager has nothing to offer when the first page is empty and final
    Given an open-ended pager on its first page with no rows and nothing more
    Then it draws nothing
