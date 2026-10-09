Feature: Parameter autocomplete
  As a person who starts a run or writes a scenario
  I want the parameter line to offer the names and the values the run declares
  So that I can set a parameter without reading the agent's code first.

  Background: one line, two kinds of suggestion.
    A parameter line reads "name=value, name=value". The field that edits it
    offers suggestions for the token under the cursor. Before the "=" of a
    token it is in key mode and lists the declared parameters. After the "="
    it is in value mode and lists what the parameter accepts.

    The declared parameters are the union of what the scenarios of the run
    declare and what the agents of the run declare. A scenario declaration
    wins on a name both declare. Each suggestion says where it comes from:
    the scenario, or the agent by its label.

    The suggestions are a help, not a gate. Free text always commits, and a
    value the run cannot accept is refused by the server when the run starts.

  # --- Suggestions ---

  @integration
  Scenario: Key mode lists every declared parameter with its description, default and source
    Given a run whose scenarios declare "locale" and whose agent declares "model" with the default "gpt-5-mini"
    When the parameter line is focused before any "="
    Then the list offers "locale" from the scenario and "model" from the agent
    And each entry shows its description and its default

  @integration
  Scenario: Value mode lists the options of a closed list
    Given an agent that declares "model" with the options "gpt-5-mini" and "gpt-5"
    When "model=" is typed on the parameter line
    Then the list offers "gpt-5-mini" and "gpt-5"
    And choosing one writes "model=gpt-5" on the line

  @unit
  Scenario: Value mode offers the default and the typed text when the list is open
    Given a parameter "locale" with the default "en" and no options
    When "locale=d" is typed on the parameter line
    Then the list offers "en" and the typed text "d"

  @unit
  Scenario: Free text always commits
    Given a parameter "model" with the options "gpt-5-mini" and "gpt-5"
    When "model=claude" is typed and no suggestion is chosen
    Then the line holds "model=claude"
    And nothing on the field refuses it

  @unit
  Scenario: A scenario declaration wins over the agent's on a name both declare
    Given a scenario that declares "model" with the default "gpt-5"
    And an agent that declares "model" with the default "gpt-5-mini"
    When the declared parameters of the run are read
    Then "model" reads from the scenario with the default "gpt-5"
    And a name only the agent declares reads from the agent with the agent's label

  @unit
  Scenario: The equals sign and the comma separate the tokens of a parameter line
    Given the text "model=gpt-5, loc" with the cursor at its end
    When the suggestion state is read with the parameter grammar
    Then it is in key mode with the query "loc"
    And with the cursor after "model=" it is in value mode for "model"
    And the traces search grammar keeps ":" as its separator

  @integration
  Scenario: The keyboard drives the list
    Given the parameter line with its list open
    When the arrow keys are pressed
    Then the highlight moves through the list
    And Enter or Tab writes the highlighted entry on the line
    And Escape closes the list without changing the line

  @integration
  Scenario: The placeholder reads the first declared parameter
    Given a run whose first declared parameter is "model" with the default "gpt-5-mini"
    When the parameter line is empty
    Then its placeholder reads "model=gpt-5-mini"

  # --- Where the field sits ---

  @integration
  Scenario: A compare row offers the options of its own agent
    Given a comparison with two rows on agents that declare different options for "model"
    When "model=" is typed on the second row
    Then the list offers the options the second row's agent declares

  @integration
  Scenario: The case editor offers the parameters the agents declare
    Given a project whose agent declares "model" with the options "gpt-5-mini" and "gpt-5"
    When the parameters block of the scenario editor is focused
    Then the list offers "model" from the agent
    And "model=" offers its options

  # --- Values and refusals ---

  @unit
  Scenario: A typed value reaches the run as the declared type
    Given a parameter "order_id" declared as a string and a parameter "seats" declared as a number
    When "order_id=007, seats=5" is sent
    Then "order_id" is sent as the text "007"
    And "seats" is sent as the number 5

  @integration
  Scenario: A value outside a closed list is refused on the field
    Given the run dialog with "model=claude" on the parameter line
    When the run is refused with "scenario_parameter_option_invalid" naming "model"
    Then the refusal reads under the parameter line
    And it names the options the parameter accepts
