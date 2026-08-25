Feature: The wide run detail drawer
  As a person reading a finished run
  I want the judge results beside the conversation when the screen allows
  So that I can read a rubric and the message that decided it at the same time

  Background: one drawer, two layouts.
    Agent Testing opens the same run detail drawer the current product uses,
    with a wider variant. In the wide variant the conversation and the results
    sit side by side when the width allows. When it does not, the results stay
    stacked under the conversation, exactly as they are today.

    The results read as one flat list of the criteria of the test case, in the
    order the case declares them, each one marked met or unmet. Nothing there
    repeats the chips at the top of the drawer: no status, no success rate, no
    criteria count and no duration.

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
    Given a long conversation and a long list of rubrics side by side
    When the conversation is scrolled
    Then the results stay where they are
    And scrolling the results does not move the conversation

  # --- Content ---

  @integration
  Scenario: The drawer shows the same content in both layouts
    Given a finished run with a conversation, rubric verdicts, a duration and a cost
    When the drawer is read in the wide layout and then in the stacked layout
    Then the same conversation, verdicts, duration and cost are shown in both

  @integration
  Scenario: The results read as one flat list of the criteria
    Given a finished run whose judge met two criteria and missed one
    When the results are read
    Then the three criteria read as one list, in the order the case declares them
    And met and unmet are not split into two sections
    And a met criterion carries a green check and an unmet one a red cross

  @integration
  Scenario: The results panel is headed Results and repeats no chip
    Given a finished run open in the drawer
    When the results panel is read
    Then it is headed "Results"
    And it shows no status, no success rate, no criteria count and no duration
    And there is no terminal log box

  @integration
  Scenario: What the judge said about the run as a whole reads last
    Given a finished run whose judge gave a reason for the whole run
    When the results are read
    Then that reason reads as a muted paragraph under the criteria

  @integration
  Scenario: The drawer header offers Edit for the test case that ran
    Given a run open in the drawer
    When its header is read
    Then an Edit control for the test case is offered
    And using it opens the case editor

  @integration
  Scenario: A run that is still going shows the conversation growing beside empty results
    Given a running run open in the wide drawer
    When messages arrive
    Then the conversation grows on the left
    And the results side reads that the judge has not run yet
    And it never reads a score of 0 out of 0

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
