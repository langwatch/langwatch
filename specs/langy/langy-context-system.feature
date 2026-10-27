Feature: Langy captures what I am viewing as turn context
  As a LangWatch user chatting with Langy
  I want Langy to know which experiment, trace, prompt, dataset, or dashboard I am looking at
  So that I can ask about "this" without spelling out ids, and see exactly what Langy is working from

  # The page I am on is surfaced as removable chips inside the top of the
  # composer, and the same context rides along with the turn I send. Context is
  # captured from the page I am viewing; a chip I dismiss stays gone until the
  # underlying page context changes, and a "+ context" control lets me add more.
  # Page context is offered, not chosen, except the dashboard I am viewing,
  # which is attached for me.

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
    Then the add-context control offers a chip for that experiment

  @integration
  Scenario: Viewing a trace surfaces it as context
    Given I am viewing a trace
    Then the add-context control offers a chip for that trace

  @integration
  Scenario: Viewing a prompt, dataset, or dashboard surfaces it as context
    Given I am viewing a dataset
    Then the add-context control offers a chip for that dataset

  @integration
  Scenario: Viewing a dashboard attaches that board as context without a click
    Given I am viewing a dashboard
    Then the composer already shows a context chip for that dashboard
    And the chip carries the dashboard's id, so a chart Langy places lands on that board
    And every message I send carries that dashboard as turn context

  @integration
  Scenario: A removed dashboard chip stays removed and can be added back
    Given the composer shows the chip of the dashboard I am viewing
    When I remove the dashboard chip
    Then the dashboard chip is no longer shown
    And the add-context control offers it back
    When I add the dashboard back
    Then the composer shows the dashboard chip again

  @integration
  Scenario: Only a dashboard attaches itself; other pages still only offer their context
    Given I am viewing a trace, an experiment or a dataset
    Then the composer shows no context chip until I choose one

  @integration
  Scenario: Dashboard pages that show no one board offer no board as context
    Given I am on the dashboards list, the templates library or a From LangWatch board
    Then the composer shows no dashboard chip
    And the add-context control offers no dashboard chip

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
  Scenario: Starting a new chat starts with no context chosen
    Given I have chosen context chips for the current chat
    When I start a new chat
    Then no context chip is chosen for the fresh turn
    And the context I assembled for the last question does not follow me into the next

  @unit
  Scenario: The dataset page offers its dataset by name
    Given the user is on a dataset's page
    When the page has loaded the dataset
    Then the dataset chip Langy offers carries the dataset's name and its id
    And it replaces the route's chip, which only knows the id

  @unit
  Scenario: The board chip carries the period the user is viewing
    Given the user is on a dashboard over the last 30 days at one bucket per day
    When the board tells Langy what is on screen
    Then the dashboard chip reads the board's name and "30d · 1d"
    And what Langy is handed names the board's id, its period and its grain
    And it replaces the route's chip, which only knows the id
