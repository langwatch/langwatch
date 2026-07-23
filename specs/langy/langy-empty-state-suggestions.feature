Feature: The panel's empty state offers asks the project can act on
  As a person opening Langy on my project
  I want the suggested asks to match what my project actually has
  So that nothing I click can only dead-end

  The panel's empty state and the home page's capability row share one
  selection, so the two surfaces never disagree about what is honest to
  offer. Setup asks name a gap; once the gap closes they are withdrawn.

  Scenario: A project with nothing in it is offered ways to get set up
    Given my project has no traces
    When I open the Langy panel on a fresh conversation
    Then the suggestions offer to onboard my agent
    And no suggestion asks about traces, evaluations or runs that do not exist

  Scenario: Onboarding is withdrawn once the first trace arrives
    Given my project has traces
    When I open the Langy panel on a fresh conversation
    Then no suggestion offers to onboard my agent

  Scenario: Choosing what to measure is withdrawn once evaluations exist
    Given my project has traces and evaluations
    When I open the Langy panel on a fresh conversation
    Then no suggestion offers to choose what to measure

  Scenario: A project that has reached everything sees the full range
    Given my project has traces, evaluations and experiment runs
    When I open the Langy panel on a fresh conversation
    Then every suggestion is a real ask the project can act on
    And the most capable ask leads

  Scenario: No asks are offered while the project's reach is unknown
    Given the project's reach has not answered yet
    When I open the Langy panel on a fresh conversation
    Then no suggestions are shown
    And the greeting does not point at a list that is not there
