Feature: Create a test suite from a template

  The + next to test suites on the Agent Testing rail opens a menu: Blank suite
  names an empty suite as before, From template opens a gallery of suite
  templates. The gallery lists archetypes and red team packs, previews every
  scenario of the chosen template, asks how the template fits the agent under
  test, and creates the suite with its scenarios in one step.

  # modules/scenario/browser: ui/sections/agent-testing/suite-template-gallery/
  # modules/scenario/browser: ui/sections/agent-testing/suite-rail/suite-rail.tsx

  Background:
    Given a project the reader may manage scenarios in
    And the Agent Testing page is open

  @integration
  Scenario: The add control offers a blank suite or a template
    When the reader opens the add control next to test suites
    Then the menu offers "Blank suite" and "From template"

  @integration
  Scenario: Blank suite keeps the naming dialog
    When the reader chooses "Blank suite"
    Then the dialog that names a new test suite opens

  @integration
  Scenario: The gallery sorts templates into archetypes and red team packs
    Given the project lists one archetype and one red team pack
    When the reader chooses "From template"
    Then the Archetypes tab shows the archetype with its title, description and scenario count
    And the Red team tab shows the red team pack

  @integration
  Scenario: The gallery shows loading while the templates are read
    Given the template list has not answered yet
    When the reader opens the gallery
    Then the gallery shows a loading state

  @integration
  Scenario: A tab with no template says so
    Given the project lists only red team packs
    When the reader opens the Archetypes tab
    Then the tab says there is no template of that kind yet

  @integration
  Scenario: The template list fails to load
    Given the template list answers with an error
    When the reader opens the gallery
    Then the gallery shows that the templates could not be loaded

  @integration
  Scenario: Choosing a red team pack previews each attack
    When the reader chooses a red team pack
    Then the preview lists every scenario with its name, attack goal and OWASP ids

  @integration
  Scenario: The fit step needs the agent name
    Given the reader moved from the preview to the fit step
    When the reader creates the suite with no agent name
    Then the agent name field says it is required
    And no suite is created

  @integration
  Scenario: Create applies the template and opens the new suite
    Given the reader filled the agent name, added tools as tags and listed what the agent must never do
    When the reader creates the suite
    Then applyTemplate is called with the template id, the fit and the optional suite name
    And the new suite opens on the rail

  @integration
  Scenario: A refused create keeps the dialog open
    Given applyTemplate answers with an error
    When the reader creates the suite
    Then the failure is reported through the shared error toast
    And the dialog stays open on the fit step

  @integration
  Scenario: The Free plan cap shows the existing upgrade message
    Given applyTemplate answers with the scenario limit refusal
    When the reader creates the suite
    Then the refusal goes to the shared error handler, which opens the upgrade message
    And the gallery draws no second message of its own

  @unit
  Scenario: The preview names each OWASP category by its official name
    Given a red team scenario tagged with OWASP id "LLM07"
    When the gallery shows the scenario in the preview
    Then its badge reads "LLM07 System Prompt Leakage"

  @integration
  Scenario: Choosing another template starts its fit afresh
    Given I named the suite and saw the agent name error on one template's fit step
    When I go back and choose another template
    Then its fit step shows no suite name and no agent name error

  @integration
  Scenario: Closing the gallery while it creates opens nothing
    Given I pressed Create suite
    When I close the gallery before the create lands
    Then the new suite is not opened

  @integration
  Scenario: Create suite is sent once while a create is in flight
    Given a create is in flight
    When I press Create suite again
    Then no second create is sent and the button shows it is busy

  @integration
  Scenario: The preview fills only the placeholders the server fills
    Given template copy with "{{agentName}}" and "{{ agentName }}"
    When the gallery shows it before the fit step
    Then only "{{agentName}}" reads as "your agent"
