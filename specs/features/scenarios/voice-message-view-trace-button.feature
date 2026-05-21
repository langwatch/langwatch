Feature: View Trace button on voice messages in simulation run UI
  As a user reviewing a simulation run that includes voice (audio) turns
  I want voice/audio messages to expose the same "View Trace" affordance as text and tool turns
  So that I can jump from any model-generated turn — including voice — to its underlying trace

  Background:
    Given I am viewing a simulation run in the run detail drawer
    And the run's conversation is rendered by ScenarioMessageRenderer

  @integration
  Scenario: Assistant audio turn with a trace id shows the View Trace button in drawer variant
    Given the renderer is mounted in drawer variant (variant === "drawer", smallerView === false)
    And the conversation contains an assistant message rendered as a media item with a non-empty traceId
    When the renderer paints that turn
    Then a "View Trace" button is shown under the media bubble
    And the button has the same affordance (button + hover-peek) as the text / tool-call / tool-result branches

  @integration
  Scenario: Assistant audio turn without a trace id does not show the button
    Given the renderer is mounted in drawer variant
    And the conversation contains an assistant message rendered as a media item with no traceId
    When the renderer paints that turn
    Then no "View Trace" button is shown under the media bubble

  @integration
  Scenario: User-role audio turn does not show the View Trace button
    Given the renderer is mounted in drawer variant
    And the conversation contains a user message rendered as a media item with a non-empty traceId
    When the renderer paints that turn
    Then no "View Trace" button is shown under the media bubble
    # Mirrors the role gate the text branch applies — only assistant turns get the affordance

  @integration
  Scenario: Clicking View Trace on an audio turn opens the trace details drawer
    Given an assistant media turn in drawer variant has a "View Trace" button
    When I click the button
    Then the trace details drawer opens for that traceId
    # Wiring is delegated to TraceMessage's existing click handler — no new wiring expected

  @integration
  Scenario: Grid variant suppresses the View Trace button on audio turns
    Given the renderer is mounted in grid variant (variant === "grid", smallerView === true)
    And the conversation contains an assistant message rendered as a media item with a non-empty traceId
    When the renderer paints that turn
    Then no "View Trace" button is shown under the media bubble
    # Matches how the other kinds behave in grid view

  @integration
  Scenario: Transcript-collapse case renders one bubble with one View Trace button
    Given the renderer is mounted in drawer variant
    And an assistant message contains both an audio part and a text-transcript part with a shared non-empty traceId
    When the renderer paints that turn
    Then exactly one bubble is rendered for that turn
    And exactly one "View Trace" button is shown under that bubble
    # No duplication between the media branch and the (now-collapsed) text branch

  @integration
  Scenario: Existing trace-button behavior on text and tool turns is unchanged
    Given the renderer is mounted in drawer variant
    And the conversation contains assistant text, tool-call, and tool-result turns with non-empty traceIds
    When the renderer paints those turns
    Then each turn shows its existing "View Trace" affordance exactly as before
    # Guards the existing test suite against regressions when the media branch is changed

  # --- AC Coverage Map ---
  # AC 1 ("drawer variant: assistant media + traceId shows View Trace, same affordance as other branches")
  #   -> Scenario: Assistant audio turn with a trace id shows the View Trace button in drawer variant
  # AC 2 ("media item with no traceId, or role !== assistant, does not show the button — same gate as text branch")
  #   -> Scenario: Assistant audio turn without a trace id does not show the button
  #   -> Scenario: User-role audio turn does not show the View Trace button
  # AC 3 ("button opens the trace details drawer for that trace id — delegated to TraceMessage's existing click handler")
  #   -> Scenario: Clicking View Trace on an audio turn opens the trace details drawer
  # AC 4 ("grid variant continues to suppress the button on media, matching how other kinds behave in grid view")
  #   -> Scenario: Grid variant suppresses the View Trace button on audio turns
  # AC 5 ("transcript-collapse case still renders a single bubble and a single View Trace button — no duplication")
  #   -> Scenario: Transcript-collapse case renders one bubble with one View Trace button
  # AC 6 ("existing tests pass; a new test covers AC 1 and AC 2 in the renderer's test suite")
  #   -> Scenarios covering AC 1 and AC 2 (above) supply the new coverage
  #   -> Scenario: Existing trace-button behavior on text and tool turns is unchanged (guards "existing tests pass")
