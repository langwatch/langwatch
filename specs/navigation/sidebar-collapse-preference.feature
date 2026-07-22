Feature: Sidebar collapse preference (global, remembered)
  As a LangWatch user
  I want to collapse or expand the sidebar from any page and have that choice
  remembered everywhere
  So that I control how much room the navigation takes without re-deciding on
  every page

  The toggle lives where the logo sits, top-left of the header: when the
  sidebar is expanded, hovering the logo area reveals a collapse control at
  its right edge; when the sidebar is collapsed, hovering the logo itself
  swaps it for the expand control. The preference is a single global choice,
  not a per-page one.

  Background:
    Given a signed-in user on a desktop-sized screen

  @bdd @ui @sidebar @collapse
  Scenario: Collapsing the sidebar from any page
    Given the sidebar is expanded
    When the user hovers the logo area and clicks "Collapse sidebar"
    Then the sidebar shrinks to its icon rail
    And the choice is saved as the user's global sidebar preference

  @bdd @ui @sidebar @collapse
  Scenario: Expanding a collapsed sidebar via the logo
    Given the sidebar is collapsed
    When the user hovers the logo area
    Then the logo swaps to an "Expand sidebar" control
    And clicking it expands the sidebar
    And the choice is saved as the user's global sidebar preference

  @bdd @ui @sidebar @collapse @persistence
  Scenario: The preference follows the user across pages
    Given the user collapsed the sidebar on the Traces page
    When the user navigates to Experiments, Settings, or any other page
    Then the sidebar stays collapsed
    And expanding it on any of those pages expands it everywhere

  @bdd @ui @sidebar @collapse @persistence
  Scenario: The preference survives a reload
    Given the user collapsed the sidebar
    When the user reloads the browser
    Then the sidebar renders collapsed

  @bdd @ui @sidebar @collapse @defaults
  Scenario: Pages keep their default density until the user chooses
    Given the user has never toggled the sidebar
    When the user visits a page that defaults to a compact sidebar
    Then the sidebar renders compact on that page
    But once the user explicitly expands or collapses it anywhere,
        their choice wins on every page

  @bdd @ui @sidebar @collapse @responsive
  Scenario: Small screens stay compact
    Given the browser window is narrower than the desktop breakpoint
    Then the sidebar is always collapsed to the icon rail
    And hovering the rail still reveals the expanded overlay
    And the collapse control is not offered

  @bdd @ui @sidebar @collapse @hover
  Scenario: A collapsed sidebar still expands on hover
    Given the sidebar is collapsed
    When the user hovers over the icon rail
    Then the expanded sidebar overlays the content temporarily
    And moving the pointer away collapses it back
