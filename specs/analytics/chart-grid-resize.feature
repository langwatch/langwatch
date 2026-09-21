Feature: Drag-to-resize chart cards on a finer grid

  Today a card's size is one of four fixed presets (a small square, a wide
  rectangle, a tall rectangle, a large square), chosen from the card's
  overflow menu — never dragged. The analytics dashboard grid this covers is
  laid out on exactly two fluid columns, so those four presets are the only
  two widths that exist at all: half the grid or the whole thing. This feature
  replaces the picker with a drag handle and switches the grid to a finer unit
  — a column is a fraction of the container's width (an eighth, so a card can
  span anywhere from one eighth to the full row) and a row is a fixed 100px —
  so a member drags a card to the size they want and it snaps to that grid
  instead of landing on one of four preset shapes.

  Existing cards are not repositioned or reflowed the moment this ships: each
  one's current size is converted once, to whichever new size renders at the
  same width and height it already had, so nobody's dashboard rearranges
  itself under them on the first load after this feature deploys.

  Background:
    Given a grid of chart cards on the analytics dashboard

  @unit
  Scenario: A drag lands on the nearest grid cell, not an arbitrary pixel
    Given a member is dragging a card's resize handle
    When they release it between two grid lines
    Then the card snaps to the nearer line in each dimension, so its edge is
      always a whole number of columns and rows wide and tall

  @unit
  Scenario: A card cannot be dragged smaller than one cell
    Given a member is resizing a card
    When they drag its edge past the point where it would be less than one
      column wide or one row tall
    Then the resize stops at one cell in that dimension, rather than
      collapsing the card further or removing it

  @integration
  Scenario: A resize that would overlap a neighbor pushes it aside instead
    Given two cards sitting side by side with no free grid space between them
    When a member drags the left card wider, into the second card's space
    Then the second card is pushed to the next free position rather than
      being hidden underneath the resized one, and both remain visible

  @integration
  Scenario: Resizing and reordering stay separate gestures
    Given a chart card with a sandboxed iframe body
    When a member drags the card's header
    Then the card reorders among its siblings, exactly as it does today
    When a member instead drags the card's resize handle
    Then only the card's size changes, its position among siblings does not,
      and neither gesture starts by dragging inside the iframe itself — the
      handle sits outside its bounds the same way the header drag handle
      already does

  @integration
  Scenario: A resized card keeps its new size after the page reloads
    Given a member has resized a card to a size with no equivalent among the
      four old presets
    When they reload the page
    Then the card renders at the same size they left it at

  @integration
  Scenario: Every pre-existing card converts once, to the same size it already rendered at
    Given a dashboard whose cards were all sized before
      this feature shipped, using the old small/wide/tall/large presets
    When the page is opened for the first time after this feature ships
    Then every card renders at the same width and height it rendered at
      before, translated into the new grid's columns and rows rather than
      left keyed to a preset name that no longer exists
    And no card visibly moves or changes size on this first load — the
      conversion is silent
