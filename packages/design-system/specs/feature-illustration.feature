Feature: A branded feature's illustrations are decorative and stay still
  As a reader on a branded feature's empty state or upsell
  I want the art to support the copy and stay still
  So that the page is calm, readable and the same in light and dark

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The empty state and the Enterprise art never animate
    Given a reader who has not asked for less motion
    When the Braids empty state and Enterprise illustrations render
    Then neither is animated

  @integration
  Scenario: Illustrations are hidden from assistive technology
    Given any Braids illustration
    When it renders
    Then it is hidden from assistive technology

  @integration
  Scenario: Two illustrations on one page never share a mask
    Given two Braids empty state illustrations on the same page
    When both render
    Then every mask id on the page is unique

  @integration
  Scenario: Illustrations follow a forced colour mode
    Given the Braids Enterprise illustration forced to dark mode
    When it renders
    Then it carries the dark colour-mode class so its tokens take their dark values

  @integration
  Scenario: The Braids empty state matches the brand kit
    # Decided by Alex, 2026-11-18 (3a): dev/docs/plans/braids/brand/braids-empty-state.svg is the source.
    When the Braids empty state illustration renders
    Then its strands are dotted, since the projects are not braided yet
    And each project shows a square badge with two letters
    And the strands take the kit's orange, blue and green, never purple
    And the empty trace carries a "+" target where a braid starts
    And every colour comes from a token, so light and dark both hold
