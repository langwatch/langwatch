Feature: The Add to Dataset preview stays reachable at any width
  As a user adding traces to a dataset
  I want every column of the preview to be reachable
  So that I can check and edit the whole row before it is added

  @integration
  Scenario: The Add to Dataset preview scrolls sideways inside its card
    Given the Add to Dataset drawer with more columns than the preview card can show
    Then the preview card stays inside the drawer
    And the preview scrolls sideways inside its card
    And scrolling to the end brings the last column fully into view
