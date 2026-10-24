Feature: A branded feature's illustrations are decorative and respect motion settings
  As a reader on a branded feature's empty state, upsell or landing page
  I want the art to support the copy without moving when I asked for less motion
  So that the page is calm, readable and the same in light and dark

  See packages/design-system/docs/feature-branding.md.

  @integration
  Scenario: The hero weaves in once when motion is allowed
    Given a reader who has not asked for less motion
    When the Braids hero illustration renders
    Then each project's strand animates in once, one after another

  @integration
  Scenario: The hero stands still for a reader who asked for less motion
    Given a reader who has asked their system for less motion
    When the Braids hero illustration renders
    Then no strand or span is animated

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
    Given two Braids hero illustrations on the same page
    When both render
    Then every mask id on the page is unique

  @integration
  Scenario: Illustrations follow a forced colour mode
    Given the Braids Enterprise illustration forced to dark mode
    When it renders
    Then it carries the dark colour-mode class so its tokens take their dark values
