Feature: Drawer with form pattern
  As someone building a long form that is edited beside its page
  I want one runnable example of a drawer with tabs, a pinned footer and a connection test
  So that I copy a form that keeps the reader's edits, in light and dark

  @integration
  Scenario: Every drawer story shows its state in light and dark
    Given the named stories of the Drawer with form pattern
    When each is rendered in the light and in the dark colour mode
    Then it shows its own heading, fields, message or notice

  @integration
  Scenario: A tab keeps what was typed in it
    Given the agent open for editing
    When the reader edits a header and the response path and moves between the tabs
    Then every edit is still there when they return

  @integration
  Scenario: Save changes submits the form once
    Given the agent open for editing with a new name
    When the reader presses Save changes
    Then the draft is stored once and the drawer closes
    And the page shows the new name and a notice says the agent was saved

  @integration
  Scenario: Enter in a field submits the form once
    Given the agent open for editing
    When the reader presses Enter in the name field
    Then the draft is stored once

  @integration
  Scenario: An invalid URL is said under the field
    Given the agent open for editing with a URL that has no scheme
    When the reader presses Save changes
    Then the URL field explains what is wrong and takes focus
    And nothing is stored

  @integration
  Scenario: A missing name is said under the field
    Given the agent open for editing with the name cleared
    When the reader presses Save changes
    Then the name field explains what is wrong and takes focus

  @integration
  Scenario: A refused save keeps every edit
    Given a save that is refused once
    When the reader presses Save changes
    Then the drawer says the save failed and every edit on every tab is still there
    And pressing Save changes again stores the agent

  @integration
  Scenario: Test connection shows the answer in the Test tab
    Given the agent open for editing
    When the reader presses Test connection
    Then the Test tab opens with the status, the time and what the response path returned

  @integration
  Scenario: A connection that fails says why and what to check
    Given a connection that is refused
    When the reader presses Test connection
    Then the Test tab says the endpoint could not be reached and links to troubleshooting
    And the form is as it was

  @integration
  Scenario: Test connection waits for a URL
    Given the agent open for editing with the URL cleared
    Then Test connection is disabled

  @integration
  Scenario: Cancel and Escape close the drawer and discard the draft
    Given the agent open for editing with an unsaved change
    When the reader presses Cancel or Escape
    Then the drawer closes and focus returns to Edit agent
    And opening it again shows the saved values

  @integration
  Scenario: Read-only shows the values and still allows a test
    Given someone who cannot change the agent
    When they press Test connection
    Then the answer is shown and there is no Save changes button

  @unit
  Scenario: The example uses only public design system entry points
    Given the source of the example
    Then it imports no Chakra or Emotion and no design system file by relative path
