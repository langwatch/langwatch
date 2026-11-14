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
