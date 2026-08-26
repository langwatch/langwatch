Feature: The wide run detail drawer
  As a person reading a finished run
  I want the judge results beside the conversation when the screen allows
  So that I can read a criterion and the message that decided it at the same time

  Background: one drawer, two layouts.
    Agent Testing opens the same run detail drawer the current product uses,
    with a wider variant. In the wide variant the conversation and the results
    sit side by side when the width allows. When it does not, the results stay
    stacked under the conversation, exactly as they are today.

    The results read as a labelled "Status:" line at the top, followed by the
    criteria split into a "Passed criteria" section over a "Failed criteria"
    section. Each section is drawn only when it has rows. Within a section the
    criteria keep the order the case declares them. Nothing there repeats the
    chips at the top of the drawer: no success rate, no criteria count and no
    duration.

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
    And each section keeps the criteria in the order the case declares them
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
  Scenario: The results panel is headed with a Status line
    Given a finished run open in the drawer
    When the results panel is read
    Then a "Status:" label is followed by "PASSED" in green or "FAILED" in red
    And it shows no success rate, no criteria count and no duration
    And there is no terminal log box

  @integration
  Scenario: A failed run reads FAILED in the Status line
    Given a failed run open in the drawer
    When the results panel is read
    Then the status line reads "FAILED" in red

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
    And using it opens the case editor

  @integration
  Scenario: The drawer header opens the case editor from one labelled button
    Given a run open in the drawer
    When its header is read
    Then no separate Play and Edit icon buttons are offered
    And a single "Open Scenario" button is shown next to the overflow menu
    And a run of that scenario is triggered from inside the case editor
      through its "Save & Run" control

  @integration
  Scenario: A run that is still going shows the conversation growing beside empty results
    Given a running run open in the wide drawer
    When messages arrive
    Then the conversation grows on the left
    And the results side reads "The conversation is running…" beside a spinner
    And it never reads a score of 0 out of 0

  @integration
  Scenario: A finished conversation with no verdict yet says the judge is reading it
    Given a run open in the wide drawer whose conversation has ended
    When the verdict has not been written yet
    Then the results side reads "The judge is reading the conversation…" beside a spinner
    And the criteria replace that line as soon as the verdict lands

  @integration
  Scenario: The criteria appear the moment the run settles
    Given a running run open in the wide drawer
    When the run reaches its verdict
    Then the stored run is read again
    And the criteria and the success rate read in the results
    And the drawer does not have to be closed and opened again

  # --- v1 is unchanged ---

  @integration
  Scenario: The v1 drawer keeps its width and its stacked results
    Given a project whose menu still shows Simulations rather than Agent Testing
    When a run is opened from the v1 simulations page
    Then the drawer has the width it has today
    And the results read under the conversation, in the section they are in today
