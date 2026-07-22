Feature: App shell visual language
  As a LangWatch user
  I want the sidebar, header, and content area to read as one composed frame
  So that the chrome feels calm and the current page is always obvious

  The shell is a frame: a full-height sidebar column sits on the page
  ground, and the application floats next to it as a raised card that
  carries its own header row. The brand color appears in exactly one place
  in the chrome — the active row's notch.

  @bdd @ui @shell
  Scenario: The content area floats as a card
    When any page renders inside the app shell
    Then the content sits on a fully rounded card with a hairline edge
    And a slim inset of page ground separates the card from the viewport's
        top, right, and bottom edges
    But while the assistant panel is docked, the reserved strip replaces the
        right inset and the panel floats with the same edges

  @bdd @ui @shell @header
  Scenario: The card carries its own header row
    When any page renders inside the app shell
    Then the workspace chip and breadcrumb sit in a header row inside the card
    And the search, environment badge, and account menu sit at that row's right
    And the sidebar column runs the full viewport height, with the logo and
        collapse control at its top

  @bdd @ui @shell @sidebar
  Scenario: The active destination carries the only brand accent in the chrome
    Given the user is on a sidebar destination
    Then that row shows a small brand-colored notch on its left edge
    And the notch remains visible when the sidebar is collapsed to icons
    And no other chrome element uses the brand color

  @bdd @ui @shell @sidebar
  Scenario: Section chevrons are quiet affordances
    Given a sidebar section is expanded
    Then its chevron is hidden until the pointer hovers the section header
    But a folded section always shows its chevron

  @bdd @ui @shell @header
  Scenario: Header controls share one control language
    Then the workspace chip, search field, and environment badge share the
        same compact height and corner radius
