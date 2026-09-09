Feature: The resume every AI Governance page pins above its content
  As an admin opening Inventory, People or Agents
  I want the same strip of figures at the top of each, drawn the same way
  So that I learn one summary once and read it on every page after that

  # ---------------------------------------------------------------------------
  # WHY THIS FILE EXISTS. Three pages asked for a resume strip in one round.
  # The section has already paid for that pattern once: the shared empty state
  # was written after the same requirement landed on two governance pages and
  # produced two divergent components, and the codebase still carries several
  # separate sample badges from an earlier round of the same. So the shape is
  # specified here, built once in
  # platform/app/src/components/governance/summary/, and imported by all three.
  #
  # TWO SHAPES, NOT ONE. A strip is for figures that are peers: four counts of
  # four different things, each one line long, evenly spread across one card.
  # Cards are for a summary whose parts have different shapes — a headline
  # count with a trend beneath it, a short list of statuses, a ranking. A page
  # picks whichever fits what it has to say. What it may not do is invent a
  # third.
  #
  # THE NUMBERS RULE, which is the only rule here that is about truth rather
  # than about layout. These components hold no query and perform no
  # arithmetic. Every figure arrives already measured and already formatted by
  # whoever measured it, and a figure the read side could not produce arrives
  # as null and is drawn as an em dash. A zero substituted for an unmeasured
  # figure would report an organization that has not been measured as one that
  # has nothing in it, and the reader has no way to tell those apart afterwards.
  #
  # THE BUTTON RULE DID NOT MOVE HERE, and an earlier draft of this comment
  # said it had. The product owner rejected solid orange across the whole of
  # governance, not only in empty panes, so the rule belongs where the rest of
  # the section's button vocabulary already lives: "Primary page actions sit
  # top-right in the page header" and "An empty pane's action is weighted by
  # what it does", both in governance-ui-controls.feature, now name the house
  # header button — the small outline button PageLayout.HeaderButton renders —
  # in place of the fill. Writing a competing copy of that rule here would have
  # left the section with two rulebooks disagreeing about the same button,
  # which is the drift the sibling file exists to stop.
  #
  # What the two scenarios at the foot of this file do is narrower, and worth
  # keeping for it: they pin the COMPONENT, so the shared empty state is known
  # to draw both weights correctly without a page being rendered to find out.
  # The rule they answer to is the sibling's.
  #
  # BINDING. Every scenario below carries @integration and is bound by a
  # component test that renders the real component. The annotation must share
  # the line with the JSDoc opener — `/** @scenario "…" */` — because an
  # annotation on a continuation line is dropped by the checker in silence.
  # No scenario title here contains an apostrophe, for the same class of
  # reason: a title quoted with one binds nothing and still reads as bound.
  #
  # The implementations:
  #   - platform/app/src/components/governance/summary/  — the bar, the cards,
  #     the two list rows, the sparkline
  #   - platform/app/src/components/governance/empty/    — the shared empty
  #     state and its action
  # ---------------------------------------------------------------------------

  # ===========================================================================
  # The strip
  # ===========================================================================

  @integration
  Scenario: A summary strip states each figure beside the label it counts
    Given a page hands the strip four measured figures
    When the strip renders
    Then each figure is on screen with the label of what it counts beside it
    And each hint sits under the pair it belongs to
    And no word in any label or hint is abbreviated

  @integration
  Scenario: A summary figure that was never measured reads as an em dash
    Given a page hands the strip a figure it could not measure
    When the strip renders
    Then that figure reads as an em dash
    And it does not read as zero, which would be a measurement

  @integration
  Scenario: A summary strip with no figures draws no card at all
    Given a page hands the strip nothing to show
    When the strip renders
    Then no card is drawn
    # An empty bordered strip reads as a component that failed to arrive,
    # which is the same failure the section's empty state was written to end.

  # ===========================================================================
  # The cards
  # ===========================================================================

  @integration
  Scenario: A summary card names what it holds in an eyebrow above its content
    Given a card given an eyebrow and some content
    When the card renders
    Then the eyebrow names what the card holds
    And the content sits beneath it

  @integration
  Scenario: A status row states the count and what those items are doing
    Given a status row for eleven items that are responding
    When the row renders
    Then it states the count and the word for what they are doing
    And its coloured dot is marked decorative, because colour alone says nothing
      to a reader who cannot separate the two

  @integration
  Scenario: A ranked row puts the name on the left and its share on the right
    Given a ranked row for one named spender and its share
    When the row renders
    Then the name and the share are both on screen in one row

  @integration
  Scenario: A summary sparkline is left out when there is nothing to draw
    Given a card given fewer than two points to plot
    When the card renders
    Then no sparkline is drawn
    And no flat line is drawn either, which would claim the series held still

  # ===========================================================================
  # What an empty pane may press
  # ===========================================================================

  @integration @regression
  Scenario: An empty pane action is drawn as the outline house button
    Given an empty pane offering the action that creates the page's own thing
    When the pane renders
    Then that action is drawn as the section house button, which is outline
    And it is not drawn as a solid fill

  @integration @regression
  Scenario: A quieter empty pane action is drawn quieter than the house button
    Given an empty pane offering a way out that only changes what is shown
    When the pane renders
    Then that action is drawn quieter than the house button
    And the two treatments are not the same, so the distinction survives
