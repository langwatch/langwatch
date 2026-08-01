Feature: Langy composer, feedback, and card polish
  The Langy panel's composer, feedback affordance, GitHub connect card, skill
  chips, and trace links behave calmly and route through the app rather than
  reloading it.

  Background:
    Given the Langy panel is open in a project

  Scenario: The composer invites a first message with a sheen
    Given the conversation is empty and idle
    Then the composer wears the animated rainbow sheen

  Scenario: The sheen drops once the conversation begins
    Given the conversation already has messages
    Then the composer does not wear the sheen

  Scenario: The sheen drops the instant a turn is sent
    Given the conversation is empty
    When the first message is sent and a turn is in flight
    Then the composer does not wear the sheen

  Scenario: Connecting GitHub opens the real integration flow
    Given Langy needs GitHub access it does not have
    When the customer chooses to install the GitHub App
    Then the LangWatch GitHub App installation flow opens
    And it is the same flow the Integrations settings page uses

  Scenario: A blocked popup falls back to the settings route
    Given the customer chooses to install the GitHub App
    When the browser blocks the popup
    Then the card offers to install from settings
    And choosing it navigates to Integrations settings without reloading the app

  Scenario: Feedback is recorded from a quick segment
    Given a completed Langy answer with the feedback affordance
    When the customer picks the "Bad" segment
    Then a down rating with a frustrated sentiment is recorded

  Scenario: Feedback accepts an inline typed score
    Given a completed Langy answer with the feedback affordance
    When the customer types the score 5 and submits it
    Then an up rating with a delighted sentiment is recorded
    And the exact number is kept alongside the rating

  Scenario: An empty typed score does not submit
    Given a completed Langy answer with the feedback affordance
    When the customer submits the inline score field while it is empty
    Then no feedback is recorded

  Scenario: A skill chip is compact until expanded
    Given a skill chip on the next turn
    Then only the skill's name shows, with no remove control
    When the customer expands the chip
    Then the target slot and the remove control appear

  Scenario: A trace link opens in place
    Given an applied proposal that opens an in-app trace
    When the customer clicks the open link
    Then the app navigates to the trace without a full page reload

  Scenario: Cmd-clicking a trace link opens a new tab
    Given an applied proposal that opens an in-app trace
    When the customer cmd-clicks or ctrl-clicks the open link
    Then the browser opens it in a new tab as usual
