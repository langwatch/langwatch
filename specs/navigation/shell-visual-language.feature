Feature: App shell visual language
  As a LangWatch user
  I want the navigation rail to read as a fixed instrument console
  So that the chrome stays constant while the workspace responds to my theme

  The shell is a console: a full-height warm-ink navigation rail on the
  left that keeps the same ink in light and dark themes, and a flat,
  edge-to-edge workspace next to it that responds to the theme. There are
  no floating cards, insets, or shadows in the chrome — the seam between
  rail and workspace is the contrast itself. The brand color appears in
  exactly three chrome places: the logo mark, the active row's indicator
  light, and the usage gauge.

  @bdd @ui @shell
  Scenario: The rail keeps its ink in both themes
    When any page renders inside the app shell
    Then the navigation rail is a warm-ink column in the light theme
    And the same warm-ink column in the dark theme
    And elements inside the rail render in their dark-theme form in both themes

  @bdd @ui @shell
  Scenario: The workspace is flat and edge-to-edge
    When any page renders inside the app shell
    Then the content fills the viewport from the rail to the right edge
    And the header is a flat row separated from the page by a hairline
    But while the assistant panel is docked, it sits as a flush full-height
        pane on the right edge, separated by its own hairline

  @bdd @ui @shell @header
  Scenario: The header row belongs to the workspace
    When any page renders inside the app shell
    Then the workspace chip and breadcrumb sit in the header row at the top
        of the content column
    And the search, environment badge, and account menu sit at that row's right
    And the rail runs the full viewport height, with the logo and collapse
        control at its top

  @bdd @ui @shell @sidebar
  Scenario: The active destination carries an indicator light
    Given the user is on a sidebar destination
    Then that row shows a small brand-colored light with a soft glow on its
        left edge
    And the row's icon and label brighten to full contrast
    And the light remains visible when the rail is collapsed to icons

  @bdd @ui @shell @sidebar
  Scenario: Section labels read as engraved console labels
    When the rail renders expanded
    Then section labels are set in the utility monospace face, small,
        uppercase, and widely tracked

  @bdd @ui @shell @sidebar
  Scenario: Section chevrons are quiet affordances
    Given a sidebar section is expanded
    Then its chevron is hidden until the pointer hovers the section header
    But a folded section always shows its chevron
