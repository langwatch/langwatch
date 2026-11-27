Feature: Home page announcements
  As someone opening a project's home page
  I want one quiet line about what LangWatch shipped lately
  So that I hear about new features without leaving my work

  The announcements rotate under the home block, one line at a time, each
  with a "New" badge and an arrow that opens the feature. The Langy
  announcement leads for readers who have Langy; it is specified in
  langy-home.feature.

  Background:
    Given a logged-in user with a selected project

  @integration
  Scenario: The newest features are announced first, in launch order
    When the home page renders
    Then the announcements are, in order:
      | heading                                            |
      | Red-team your agent against the OWASP LLM Top 10   |
      | See every agent call across projects in one trace  |
      | Follow one call across every agent it reaches      |
      | React the moment it matters                        |
    And each one carries a "New" badge

  @integration
  Scenario: Voice agent simulations are no longer announced
    When the home page renders
    Then no announcement mentions voice agent simulations

  @integration
  Scenario Outline: Each announcement opens its feature
    When I follow the "<heading>" announcement
    Then <destination>
    And a "<event>" analytics event is recorded with surface "home_banner"

    Examples:
      | heading                                           | destination                                                    | event                          |
      | Red-team your agent against the OWASP LLM Top 10  | the project's simulations page opens                           | red_team_banner_click          |
      | See every agent call across projects in one trace | the Braids settings page opens                                 | braids_banner_click            |
      | Follow one call across every agent it reaches     | the call graph docs open in a new tab                          | agent_call_graph_banner_click  |
      | React the moment it matters                       | the project's automations page opens                           | automations_banner_click       |
