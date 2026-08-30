Feature: The wide run detail drawer
  As a person reading a finished run
  I want the judge results beside the conversation when the screen allows
  So that I can read a criterion and the message that decided it at the same time

  Background: one drawer, two layouts.
    Agent Testing opens the same run detail drawer the current product uses,
    with a wider variant. In the wide variant the conversation and the results
    sit side by side when the width allows. When it does not, the results stay
    stacked under the conversation, exactly as they are today.

    The results read as a labelled "Verdict:" line, then the criteria split
    into a "Passed criteria" section over a "Failed criteria" section, then
    what the judge said. Each section is drawn only when it has
    rows. Within a section the criteria keep the order the scenario declares them.
    Nothing there repeats the chips at the top of the drawer: no success rate,
    no criteria count and no duration.

    The messages carry no section heading of their own, and no line is drawn
    between them and the results. The results column is narrow, so the drawer
    takes only the width the two parts need.

    The v1 drawer is not changed. Without the wide variant the drawer renders
    as it does today, at its current width and with the results below.

  # --- The wide layout ---

  @integration
  Scenario: On a wide screen the results sit beside the conversation
    Given the Agent Testing page on a wide screen
    When a finished run is opened in the drawer
    Then the drawer is wider than the v1 drawer
    And the conversation is on the left
    And the judge results are on the right, at the same height

  @integration
  Scenario: On a narrow screen the results stay under the conversation
    Given the Agent Testing page on a narrow screen
    When a finished run is opened in the drawer
    Then the conversation fills the width
    And the judge results read under it

  @integration
  Scenario: Making the window narrower moves the results back under the conversation
    Given a run open in the wide drawer with the results beside the conversation
    When the window is made narrower than the layout needs
    Then the results move under the conversation
    And no content is lost

  @integration
  Scenario: Both parts scroll on their own in the side-by-side layout
    Given a long conversation and a long list of criteria side by side
    When the conversation is scrolled
    Then the results stay where they are
    And scrolling the results does not move the conversation

  # --- Content ---

  @integration
  Scenario: The drawer shows the same content in both layouts
    Given a finished run with a conversation, criterion verdicts, a duration and a cost
    When the drawer is read in the wide layout and then in the stacked layout
    Then the same conversation, verdicts, duration and cost are shown in both

  @integration
  Scenario: The results split the criteria into passed and failed sections
    Given a finished run whose judge met two criteria and missed one
    When the results are read
    Then a "Passed criteria" section reads over a "Failed criteria" section
    And each section keeps the criteria in the order the scenario declares them
    And a passed row carries a green check and a failed row a red cross

  @integration
  Scenario: A pass run hides the Failed criteria section
    Given a finished run whose judge met every criterion
    When the results are read
    Then only the "Passed criteria" section is drawn
    And no empty "Failed criteria" heading is shown

  @integration
  Scenario: A fail run hides the Passed criteria section
    Given a finished run whose judge missed every criterion
    When the results are read
    Then only the "Failed criteria" section is drawn
    And no empty "Passed criteria" heading is shown

  @integration
  Scenario: The messages carry no heading and no line beside the results
    Given a finished run open in the wide drawer
    When the drawer is read
    Then no "Conversation" heading sits over the messages
    And no line is drawn between the messages and the results

  @integration
  Scenario: The verdict line reads over the criteria
    Given a finished run open in the drawer
    When the results panel is read
    Then a "Verdict:" label is followed by "PASSED" in green or "FAILED" in red
    And it sits over the criteria and the judge reasoning
    And it shows no success rate, no criteria count and no duration
    And there is no terminal log box

  @integration
  Scenario: The verdict reads the colour every other surface gives the status
    Given a finished run open in the drawer
    When the results panel is read
    Then "PASSED" reads the colour the product gives a passed run
    And the passed criteria heading reads that same colour

  @integration
  Scenario: A failed run reads FAILED in the verdict line
    Given a failed run open in the drawer
    When the results panel is read
    Then the verdict line reads "FAILED" in red

  @integration
  Scenario: What the judge said about the run as a whole reads last
    Given a finished run whose judge gave a reason for the whole run
    When the results are read
    Then that reason reads as a muted paragraph under the criteria
    And the paragraph is headed "Judge reasoning"
    And the line breaks the judge wrote are kept, and the text still wraps

  @integration
  Scenario: The drawer header offers Open Scenario for the scenario that ran
    Given a run open in the drawer
    When its header is read
    Then one labelled "Open Scenario" control for the scenario is offered
    And using it opens the scenario editor

  @integration
  Scenario: The drawer header opens the scenario editor from one labelled button
    Given a run open in the drawer
    When its header is read
    Then no separate Play and Edit icon buttons are offered
    And a single "Open Scenario" button is shown next to the overflow menu
    And a run of that scenario is triggered from inside the scenario editor
      through its "Save & Run" control

  @integration
  Scenario: A run that is still going shows the conversation growing beside empty results
    Given a running run open in the wide drawer
    When messages arrive
    Then the conversation grows on the left
    And the results side says it waits for more turns to define a verdict
    And that line reads in the middle of the column, with no spinner
    And it never reads a score of 0 out of 0

  @unit
  Scenario: A run waiting for the agent shows it writing
    Given a running run whose last message is from the simulated user
    When the conversation is read
    Then a bubble of three moving dots stands where the agent's answer will be
    And the same bubble is drawn while the agent works through its tools

  @unit
  Scenario: A run waiting for the judge shows nothing writing
    Given a running run whose last message is from the agent
    When the conversation is read
    Then no bubble of dots is drawn, as the judge writes no message
    And the run may already be over

  @integration
  Scenario: A finished conversation with no verdict yet says the judge is reading it
    Given a run open in the wide drawer whose conversation has ended
    When the verdict has not been written yet
    Then the results side reads that the judge is reading the conversation
    And the criteria replace that line as soon as the verdict lands

  @integration
  Scenario: A verdict with no criteria reads the judge's reasoning
    Given a scripted run open in the wide drawer, such as the ping of an agent test
    When its verdict lands with a reasoning and no criteria
    Then the results side reads the verdict and the reasoning
    And it does not say the judge is still reading

  @integration
  Scenario: The criteria appear the moment the run settles
    Given a running run open in the wide drawer
    When the run reaches its verdict
    Then the stored run is read again
    And the criteria and the success rate read in the results
    And the drawer does not have to be closed and opened again

  @integration
  Scenario: A failed run reads a named failure instead of a stack
    Given a run open in the wide drawer that failed before it reached a verdict
    When the results side is read
    Then it reads a title for the failure, one plain sentence and a hint
    And the raw stack the runner recorded is not shown

  @integration
  Scenario: A failed run does not read its own failure twice
    Given a failed run whose reasoning only restates the error
    When the results side is read
    Then the reasoning is not drawn a second time under the failure

  @integration
  Scenario: The detail of a failure is one click away
    Given a failed run open in the wide drawer
    When "More info" is clicked
    Then the stack reads in a monospace block that scrolls
    And its line breaks read as line breaks

  # --- v1 is unchanged ---

  @integration
  Scenario: The v1 drawer keeps its width and its stacked results
    Given a project whose menu still shows Simulations rather than Agent Testing
    When a run is opened from the v1 simulations page
    Then the drawer has the width it has today
    And the results read under the conversation, in the section they are in today
