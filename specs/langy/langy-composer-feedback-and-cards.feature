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

  @integration
  Scenario: Typing in the message field leaves the rest of the composer alone
    Given the Langy composer is idle
    When the customer types a message one character at a time
    Then the message field shows exactly what was typed
    And the model picker is not rebuilt for each character

  @integration
  Scenario: The input row still sends and opens palettes after typing
    Given the Langy composer is idle with a typed message
    When the customer presses Enter
    Then the message is sent
    And pressing the slash key at a word boundary opens the skills palette instead of typing a slash

  Rule: The composer takes no queue, and says so

    A message cannot be sent while a turn is in flight. The customer may still
    write one, and it waits in the field. The field has to say that, because a
    refused Enter looks the same as a broken one.

    @integration
    Scenario: The message field says a message waits while Langy works
      Given a Langy turn is in flight
      When the customer looks at the message field
      Then it says Langy is working and the message sends when it stops

    @integration
    Scenario: The message field says the same while the turn is stopping
      Given a Langy turn that the customer asked to stop
      When the customer looks at the message field
      Then it says Langy is working and the message sends when it stops

    @integration
    Scenario: Enter during a turn keeps the message instead of sending it
      Given a Langy turn is in flight
      When the customer types a message and presses Enter
      Then no message is sent
      And the message is still in the field

    @integration
    Scenario: The kept message sends once the turn ends
      Given a message typed during a turn that has now ended
      When the customer presses Enter
      Then that message is sent
