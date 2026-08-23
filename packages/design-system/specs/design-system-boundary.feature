# See ../adrs/001-design-system-boundary.md

Feature: Design system foundations and boundary
  As a feature web author
  I want one typed and accessible LangWatch design system
  So that feature packages render consistently without importing the app

  @architecture @typecheck
  Scenario: The design system is browser safe
    Given a consumer imports @langwatch/design-system
    Then its graph contains Chakra, React and approved browser dependencies
    And it contains no app alias, router, tRPC, Prisma, Node, server or feature implementation import

  @unit @theme
  Scenario: The default system contains LangWatch foundations
    Given the packaged default design system
    When its token CSS is generated
    Then LangWatch foundations, semantic tokens, recipes and slot recipes are present
    And package tests do not silently substitute Chakra's default system

  @unit @theme
  Scenario: A feature theme extends without being imported by the design system
    Given a feature-owned Chakra config
    When the app creates a design system with that extension
    Then base light and dark semantic token values remain available
    And the feature conditions are added after the base config
    And the design-system package has no dependency on the feature

  @integration @theme
  Scenario: Every provider uses the composed system
    Given the app has composed its installed feature theme extensions
    When any application route mounts the design-system provider
    Then that composed system is used
    And no nested provider replaces it with Chakra's default system

  @typecheck @architecture
  Scenario: Only deliberate component entry points are importable
    Given a consumer imports a supported design-system component
    Then the component is available from its named package export
    But package internals and undeclared components cannot be imported

  @browser @accessibility
  Scenario: Modal overlays are safe by default
    Given a modal dialog is opened from a keyboard control
    Then focus is trapped inside the dialog
    And background interaction and scrolling are prevented
    And closing restores focus to the trigger

  @browser @accessibility
  Scenario: Shared controls expose accessible names and focus
    Given a search input, icon action or tag editor from the design system
    When a keyboard or assistive-technology user reaches the control
    Then the control has an accessible name
    And its focus indicator is visible
    And decorative icons are hidden from the accessibility tree

  @browser @responsive
  Scenario: Shared composites have a small-screen strategy
    Given pagination or a selection action bar is rendered on a narrow viewport
    Then its controls remain operable without clipping or horizontal overflow

  @unit @motion
  Scenario: Appearance changes respect reduced motion
    Given the user prefers reduced motion
    When color mode or graphics quality changes
    Then decorative transitions and animation are disabled
