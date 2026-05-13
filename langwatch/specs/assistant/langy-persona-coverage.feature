Feature: Langy persona coverage in the workbench
  As different users in the same project workspace
  I want Langy to support my role-specific questions
  So that PMs, engineers, and other teammates can all use it effectively

  Background:
    Given I am signed in with access to a project
    And I am viewing an experiment in the workbench
    And I have evaluation view permission

  @integration
  Scenario: PM persona asks for high-level evaluator guidance
    When I ask Langy "Which evaluators should I use to track product quality this week?"
    Then Langy returns a successful response
    And the response is streamed with a conversation id

  @integration
  Scenario: Engineer persona asks for technical evaluator details
    When I ask Langy "Explain how Answer Relevancy works and what inputs it needs"
    Then Langy returns a successful response
    And the response is streamed with a conversation id

  @integration
  Scenario: General teammate persona asks for next-step help
    When I ask Langy "What should I run first to evaluate this experiment?"
    Then Langy returns a successful response
    And the response is streamed with a conversation id
