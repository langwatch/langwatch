Feature: Langy captures what I am viewing as turn context
  As a LangWatch user chatting with Langy
  I want Langy to know which experiment, trace, prompt, dataset, or dashboard I am looking at
  So that I can ask about "this" without spelling out ids, and see exactly what Langy is working from

  # The page I am on is surfaced as removable chips inside the top of the
  # composer, and the same context rides along with the turn I send. Context is
  # captured from the page I am viewing; a chip I dismiss stays gone until the
  # underlying page context changes, and a "+ context" control lets me add more.

  Background:
    Given I am signed in to LangWatch on a project
    And I have opened the Langy panel

  @integration
  Scenario: The project I am in is always part of the context
    When I open the Langy panel on a project
    Then the composer shows a context chip for the project

  @integration
  Scenario: Viewing an experiment surfaces it as context
    Given I am viewing an experiment
    When I open the Langy panel
    Then the composer shows a context chip for that experiment

  @integration
  Scenario: Viewing a trace surfaces it as context
    Given I am viewing a trace
    Then the composer shows a context chip for that trace

  @integration
  Scenario: Viewing a prompt, dataset, or dashboard surfaces it as context
    Given I am viewing a dataset
    Then the composer shows a context chip for that dataset

  @integration
  Scenario: A context chip can be removed
    Given the composer shows a context chip for a trace
    When I remove the trace chip
    Then the trace chip is no longer shown
    And it stays gone while I remain on that trace

  @integration
  Scenario: Removed context can be added back from the add control
    Given I have removed the trace chip
    When I open the "+ context" control
    And I add the trace back
    Then the composer shows the trace chip again

  @integration
  Scenario: The captured context rides along with the turn I send
    Given the composer shows a context chip for an experiment
    When I send a message to Langy
    Then the message is sent with the experiment as turn context

  @integration
  Scenario: Dismissed context returns when the underlying page changes
    Given I have removed the trace chip for one trace
    When I navigate to a different trace
    Then the composer shows a context chip for the new trace

  @integration
  Scenario: Starting a new chat restores dismissed context
    Given I have removed a context chip
    When I start a new chat
    Then the dismissed context chips return for the fresh turn
