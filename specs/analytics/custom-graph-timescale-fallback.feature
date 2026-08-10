Feature: Custom graph renders when stored config has no timeScale
  As a LangWatch user with saved custom dashboard graphs
  I want graphs whose stored configuration omits or corrupts timeScale to still render
  So that my analytics dashboard never shows a crashed graph card

  # Issue: https://github.com/langwatch/langwatch/issues/6811
  # Stored graph JSON is schema-optional for timeScale; the renderer must
  # resolve a valid "full" | number before any use.

  @unit
  Scenario: Absent timeScale resolves to the per-graph-type default
    Given a stored graph configuration with no timeScale key
    When the graph input is normalized for rendering
    Then a summary graph resolves timeScale to "full"
    And a pie or donnut graph resolves timeScale to "full"
    And a time-series graph resolves timeScale to the editor default granularity of one day

  @unit
  Scenario Outline: Malformed timeScale values resolve to a valid value with no NaN
    Given a stored graph configuration with timeScale <stored>
    When the graph input is normalized for rendering
    Then the resolved timeScale is a valid "full" or number value
    And the outgoing query input contains no NaN

    Examples:
      | stored              |
      | absent              |
      | null                |
      | ""                  |
      | "full"              |
      | "30" (string)       |
      | "abc" (non-numeric) |

  @integration
  Scenario Outline: Graph card renders without errors when timeScale is absent
    Given a stored <graphType> graph configuration with no timeScale key
    When the graph card is rendered on a dashboard
    Then the chart container is present
    And no errors are logged to the console

    Examples:
      | graphType      |
      | summary        |
      | pie            |
      | donnut         |
      | line           |
      | bar            |
      | horizontal_bar |
      | stacked_bar    |
      | area           |
      | stacked_area   |

  @integration
  Scenario: Data-point click on a pie or donnut graph without stored timeScale drills down
    Given a stored pie graph configuration with no timeScale key
    When the user clicks a data point
    Then the default drill-down navigation to the messages page occurs

  @integration
  Scenario: Data-point click on a bar graph without stored timeScale does not drill down
    Given a stored bar graph configuration with no timeScale key
    When the user clicks a data point
    Then no drill-down navigation occurs

  @unit
  Scenario: Stored numeric timeScale passes through unchanged for every non-summary graph type
    Given a stored non-summary graph configuration with timeScale 7
    When the graph input is normalized for rendering
    Then the outgoing query input carries timeScale 7

  @integration
  Scenario: Pie and donnut graphs with numeric timeScale keep the pipeline query path
    Given a stored pie graph configuration with a numeric timeScale and no pipeline
    When the graph queries for data
    Then a default pipeline is injected into the query input
    And the query input carries the stored numeric timeScale

  @unit
  Scenario: Summary graphs always query with timeScale full
    Given a stored summary graph configuration with any timeScale value
    When the graph queries for data
    Then the query input carries timeScale "full"

  @integration
  Scenario: Re-saving a graph that had no stored timeScale does not inject the key
    Given a saved graph whose stored configuration has no timeScale key
    When the user opens and re-saves the graph without editing the time scale field
    Then the persisted payload still has no timeScale key

  @e2e
  Scenario: Previously-crashing stored pie graph displays data on the dashboard
    Given a saved pie graph whose stored configuration has no timeScale key
    When the user opens the dashboard containing that graph
    Then the graph renders its data instead of a crashed card

# --- AC Coverage Map ---
# AC 1: "resolves absent timeScale per graph type before parse"          -> Scenario: Absent timeScale resolves to the per-graph-type default
# AC 2: "malformed values resolve valid, no NaN"                         -> Scenario Outline: Malformed timeScale values resolve to a valid value with no NaN
# AC 3: "each graph type renders with timeScale absent, no console.error" -> Scenario Outline: Graph card renders without errors when timeScale is absent
# AC 4: "click behavior defined with timeScale absent"                   -> Scenarios: Data-point click on a pie or donnut graph... / ...bar graph...
# AC 5: "stored numeric timeScale not clobbered"                         -> Scenario: Stored numeric timeScale passes through unchanged
# AC 6: "pie/donnut numeric timeScale keeps #1055 pipeline path"         -> Scenario: Pie and donnut graphs with numeric timeScale keep the pipeline query path
# AC 7: "summary always queries full"                                    -> Scenario: Summary graphs always query with timeScale full
# AC 8: "re-save does not mutate stored key state"                       -> Scenario: Re-saving a graph that had no stored timeScale does not inject the key
# AC 9: "single normalization site (grep)"                               -> structural check at PR review (grep evidence), no runtime scenario
# AC 10: "previously-crashing graph displays data"                       -> Scenario: Previously-crashing stored pie graph displays data on the dashboard
