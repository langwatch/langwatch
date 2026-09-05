Feature: The test suite editor
  As a person who tests an agent
  I want a test suite to declare the fields its scenarios carry and the evaluators every run in it gets
  So that a suite reads like a dataset and every conversation in it is checked the same way

  Background: what a suite declares.
    A test suite is a grouping with two optional declarations. Fields are the
    typed columns every scenario in the suite carries beyond its situation and
    criteria: an identifier such as expected_tools, and a type of text, number
    or boolean. Evaluators are the checks every conversation in the suite gets
    on top of its criteria, each one reading its inputs from the conversation,
    the scenario (its situation, its criteria or one of the fields) or the
    trace the run produced.

    The editor is a right-side drawer with the name on top and a "Customize
    test suite" block pinned to the bottom of its body. The block offers the
    two declarations as dashed chips until they are open; an open section
    carries the control that closes it again.

  # --- Ways in ---

  @integration
  Scenario: Edit suite sits between New scenario and Run suite above the table
    Given the suite "Refunds" is open
    When the line above the table is read
    Then the buttons read "New scenario", "Edit suite", "Run suite" in that order, with the recent runs between the last two
    And choosing "Edit suite" opens the suite editor on "Refunds"

  @integration
  Scenario: A person with read-only access is offered no Edit suite
    Given a person with read-only access to the project
    When the line above the table is read
    Then no "Edit suite" button is offered

  @integration
  Scenario: The rail row menu offers Edit in place of Rename
    Given a test suite in the rail
    When its row menu is opened
    Then the actions read, in order: "New scenario", "Run suite", "Edit", "Open recent runs", "Archive suite"
    And choosing "Edit" opens the suite editor on that suite

  @integration
  Scenario: The suite editor is a drawer that answers to the address
    Given the suite "Refunds" is open
    When "Edit suite" is chosen
    Then the address names the suite editor and the suite
    And a shared link opens the same editor on the same suite

  # --- What the editor holds ---

  @integration
  Scenario: The editor opens with the name and the customize block, and nothing else
    Given the suite "Refunds" declares no field and no evaluator
    When the suite editor is opened on it
    Then the name field holds "Refunds"
    And the "Customize test suite" block offers "Add fields" and "Add evaluators" as dashed chips
    And no fields section and no evaluators section is shown

  @integration
  Scenario: The customize block is pinned to the bottom of the body
    Given the suite editor open on a suite with nothing declared
    When the body is read
    Then the customize block sits at the foot of the body, under whatever space the name leaves

  @integration
  Scenario: Add fields opens the fields section with its first row in place
    Given the suite editor open on a suite with no field
    When "Add fields" is chosen
    Then a Fields section opens
    And it already holds one row, with the identifier empty and the placeholder "expected_tools"
    And the row offers the types text, number and boolean
    And the "Add fields" chip is no longer offered

  @integration
  Scenario: A field row is an identifier and a type, and nothing else
    Given the fields section open with one row
    When the row is read
    Then it holds an identifier input and a type select
    And it holds no description

  @integration
  Scenario: Fields can be added and removed
    Given the fields section holds the fields golden_sql and table_schema
    When "Add field" is chosen
    Then a third row is added, empty
    When the first row is removed
    Then the rows read table_schema, then the new row

  @integration
  Scenario: The reorder handle appears only when there is more than one field
    Given the fields section holds one field
    When the row is read
    Then it carries no reorder handle, so nothing shifts the identifier input
    When a second field is added
    Then every row carries a reorder handle

  @integration
  Scenario: A field is reordered by its handle
    Given the fields section holds the fields golden_sql and table_schema
    When the first row's handle is picked up and moved past the second row, by pointer or by keyboard
    Then the rows read table_schema, then golden_sql
    And saving declares them in that order

  @integration
  Scenario: Closing the fields section takes the fields away
    Given the fields section holds one field
    When the section's remove control is chosen
    Then the section closes
    And the "Add fields" chip is offered again
    And saving declares no field

  @integration
  Scenario: Editing a suite opens the sections it already uses
    Given the suite "Case lookups" declares two fields and one evaluator
    When the suite editor is opened on it
    Then the fields section is open with its two rows
    And the evaluators section is open with its one pill
    And the customize block offers no chip

  # --- Evaluators ---

  @integration
  Scenario: Add evaluators opens the evaluators section and the evaluator list
    Given the suite editor open on a suite with no evaluator
    When "Add evaluators" is chosen
    Then an Evaluators section opens
    And the list of saved evaluators opens for a pick

  @integration
  Scenario: The evaluators section reads as pills and an Add evaluator button
    Given the suite "Case lookups" has two evaluators attached
    When the evaluators section is read
    Then each evaluator reads as a pill carrying its name
    And an "Add evaluator" button follows the pills
    And that button is not a dashed chip

  @integration
  Scenario: A static pill is not exposed as a button
    Given a pill with nothing to click
    When it is read by assistive technology
    Then it is not exposed as a button, only as its name

  @integration
  Scenario: An interactive pill stays a button
    Given a pill that opens the evaluator editor when chosen
    When it is chosen
    Then it is exposed as a button and the choice is carried out

  @integration
  Scenario: Picking an evaluator attaches it with inferred mappings
    Given the suite declares the field golden_sql
    And the evaluator list is open from the suite editor
    When "SQL Query Equivalence" is picked
    Then it is attached with output reading the last agent message
    And expected_output reading the field golden_sql
    And it is required, because it produces a pass or fail

  @integration
  Scenario: Picking an evaluator with an unmapped required input opens its editor
    Given the suite declares no field
    And the evaluator list is open from the suite editor
    When "Exact Match" is picked
    Then it is attached with expected_output unmapped
    And the evaluator editor opens on it, scrolled to the missing input

  @integration
  Scenario: Picking an evaluator that is already attached opens it
    Given "PII Leak Scanner" is attached to the suite
    And the evaluator list is open from the suite editor
    When "PII Leak Scanner" is picked again
    Then no second attachment is made
    And the evaluator editor opens on the one that is there

  @integration
  Scenario: An evaluator created from the list lands its editor on the suite editor
    Given the evaluator list is open from the suite editor
    When "New Evaluator" is chosen and "SQL Query Equivalence" is created
    Then it is attached with inferred mappings
    And its editor opens on top of the suite editor, so back and save land there

  @integration
  Scenario: An evaluator created from the list that needs no mapping lands on the suite editor
    Given the evaluator list is open from the suite editor
    When "New Evaluator" is chosen and "PII Leak Scanner" is created
    Then it is attached with the conversation inferred
    And the suite editor is back with no editor on top

  @integration
  Scenario: Cancelling the evaluator list returns to the suite editor
    Given the evaluator list is open from the suite editor
    When the list is cancelled
    Then the suite editor is back with its draft intact

  @integration
  Scenario: A pill with a missing mapping is marked
    Given an attached evaluator whose required input reads nothing
    When the evaluators section is read
    Then its pill carries the amber border and the pulsing alert
    And the alert says "Missing variable mappings - Click to configure"
    And choosing the pill opens the evaluator editor on it

  @integration
  Scenario: A required evaluator's pill carries the required mark
    Given an attached evaluator that is required
    When the evaluators section is read
    Then its pill carries a dot titled "Required to pass"
    And an evaluator that is not required carries none

  @integration
  Scenario: The evaluator editor offers the conversation, the scenario and the trace as sources
    Given the suite declares the fields golden_sql and table_schema
    When the evaluator editor is opened on an attached evaluator
    Then the sources offered for a mapping are Conversation, Scenario and Trace
    And the Scenario source lists situation, criteria and the two fields

  @integration
  Scenario: The evaluator editor carries the Required to pass switch
    Given an attached evaluator that produces a pass or fail
    When its editor is opened
    Then a "Required to pass" switch reads under the mappings
    And it says "A failing required evaluator fails the scenario. An unrequired one reports its result beside the verdict."
    And flipping it writes the choice onto the attachment

  @integration
  Scenario: A score only evaluator cannot be required
    Given an attached evaluator that produces a score and no pass or fail
    When its editor is opened
    Then the "Required to pass" switch is off and disabled
    And it says "Scores report, they do not gate."

  @integration
  Scenario: The evaluator editor offers to remove the evaluator
    Given an attached evaluator
    When its editor is opened
    Then a "Remove evaluator" action is offered
    And choosing it takes the attachment off the suite and closes the editor

  @integration
  Scenario: A mapping edited in the editor lands on the attachment
    Given the evaluator editor open on an attached evaluator
    When expected_output is mapped to the field golden_sql
    Then the attachment reads expected_output from the scenario field golden_sql
    And the pill loses its missing mark

  @integration
  Scenario: Closing the evaluators section takes the evaluators away
    Given the evaluators section holds one evaluator
    When the section's remove control is chosen
    Then the section closes
    And the "Add evaluators" chip is offered again

  # --- Saving ---

  @integration
  Scenario: Saving writes the name, the fields and the evaluators
    Given the suite editor open on "Refunds" with the field golden_sql and one evaluator
    When the name is changed to "Case lookups" and saved
    Then the suite is updated with the name, the fields and the evaluators in one call
    And the editor closes

  @integration
  Scenario: The editor refuses an empty name
    Given the suite editor open on a suite
    When the name is cleared and saved
    Then the editor says a test suite needs a name
    And nothing is saved

  @integration
  Scenario: The editor refuses an empty field identifier before saving
    Given the fields section holds a row with no identifier
    When the suite is saved
    Then the row says a field needs an identifier
    And nothing is saved

  @integration
  Scenario: A field identifier the server refuses reads under its row
    Given the fields section holds the field "Golden SQL"
    When the suite is saved
    Then the save is refused with "suite_field_identifier_invalid"
    And the refusal reads under the row that holds "Golden SQL"

  @integration
  Scenario: A field an evaluator still reads cannot be removed
    Given the suite declares golden_sql and an evaluator reads it
    When golden_sql is removed and the suite is saved
    Then the save is refused with "suite_field_in_use"
    And the refusal names golden_sql and says to change the evaluator first

  @integration
  Scenario: A refusal the editor cannot place reads as a toast
    Given the suite editor open on a suite
    When the save fails for a reason the editor has no field for
    Then the refusal reads as a toast
    And the editor stays open with what was typed

  # --- The header line ---

  @integration
  Scenario: The header lists the fields and the evaluators of the open suite
    Given the suite "Case lookups" declares the fields golden_sql (text) and attempts (number), and one evaluator
    When the line above the table is read
    Then a Fields group reads each field as a chip with its type icon and its identifier
    And an Evaluators group reads each evaluator as a pill
    And the count line reads "4 scenarios · 2 fields · 1 evaluator"

  @integration
  Scenario: The header shows a group only when it has something to list
    Given the suite "Refunds" declares one field and no evaluator
    When the line above the table is read
    Then a Fields group is shown
    And no Evaluators group is shown

  @integration
  Scenario: A suite with nothing declared shows no chips row
    Given the suite "Refunds" declares no field and no evaluator
    When the line above the table is read
    Then no chips row is shown
    And the count line reads the scenarios alone

  @integration
  Scenario: Choosing a header chip opens the suite editor
    Given the suite "Case lookups" declares one field and one evaluator
    When the field chip is chosen
    Then the suite editor opens on the suite
    When the evaluator pill is chosen
    Then the suite editor opens on the suite, and the evaluator editor on that evaluator

  # --- The scenario editor ---

  @integration
  Scenario: The scenario editor asks for each suite field after the criteria
    Given the suite declares golden_sql (text), attempts (number) and strict (boolean)
    When the scenario editor is opened on a scenario of the suite
    Then after the criteria it asks for golden_sql as a text area two lines tall that grows
    And for attempts as a number input
    And for strict as a switch

  @integration
  Scenario: The field values are saved with the scenario
    Given the suite declares golden_sql (text) and attempts (number)
    When "SELECT 1" is typed into golden_sql, 3 into attempts, and the scenario is saved
    Then the scenario is saved with the field values golden_sql "SELECT 1" and attempts 3
    And a field left blank is saved with no value

  @integration
  Scenario: Editing a scenario shows the values it already carries
    Given a scenario of the suite carries golden_sql "SELECT 1"
    When the scenario editor is opened on it
    Then golden_sql reads "SELECT 1"

  @integration
  Scenario: A boolean field stored as yes or no shows checked or unchecked
    Given a scenario carries the word "yes" for the boolean field strict
    When the scenario editor is opened on it
    Then the strict switch shows checked

  @integration
  Scenario: Values of fields the suite no longer declares are listed and can be removed
    Given a scenario carries a value for legacy_note, which the suite no longer declares
    When the scenario editor is opened on it
    Then a "Not in this suite" block lists legacy_note and its value
    And removing it drops the value from the next save

  @integration
  Scenario: Moving a scenario to another suite asks for that suite's fields
    Given the scenario editor open on a scenario, with the suite select changed to a suite that declares expected_tools
    When the fields are read
    Then expected_tools is asked for
    And the fields of the previous suite are no longer asked for
