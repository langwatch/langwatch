Feature: Sidebar hierarchy refinements
  As a LangWatch user
  I want the sidebar to rank destinations the way I actually use them
  So that cross-cutting tools are one glance away and status pills don't
  shout over the current page

  @bdd @ui @sidebar @hierarchy
  Scenario: Analytics sits next to Home, outside any section
    When the user looks at the top of the sidebar
    Then "Home" and "Analytics" render as ungrouped entries above the sections
    And the "Observe" section starts below them

  @bdd @ui @sidebar @hierarchy
  Scenario: Status pills are quiet
    When a destination carries a "Legacy", "Beta", or "Preview" pill
    Then the pill renders in its outline form
    And the active row's emphasis remains the strongest signal in the sidebar
