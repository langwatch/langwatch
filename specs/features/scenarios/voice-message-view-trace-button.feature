Feature: Turn separators on voice messages in simulation run UI
  As a user reviewing a simulation run that includes voice (audio) turns
  I want traced turns — including voice — to be headed by the same turn separator
  So that I can jump from any turn's separator to its underlying trace

  # Turn separators replaced the per-message "View Trace" buttons: consecutive
  # messages sharing a trace id group into a turn, and each turn is headed by a
  # "TURN N · View trace" separator with hover-preview and click/keyboard
  # activation opening the trace drawer (owned by RunTurnSeparator; the
  # drawer-open behavior is browser-verified).

  Background:
    Given I am viewing a simulation run in the run detail drawer
    And the run's conversation is rendered by ScenarioMessageRenderer

  @integration
  Scenario: Assistant audio turn with a trace id shows a turn separator in drawer variant
    Given the renderer is mounted in drawer variant
    And the conversation contains an assistant message rendered as a media item with a non-empty trace id
    When the renderer paints that turn
    Then a turn separator carrying that trace id renders above the media bubble

  @integration
  Scenario: Assistant audio turn without a trace id renders no separator
    Given the renderer is mounted in drawer variant
    And the conversation contains an assistant message rendered as a media item with no trace id
    When the renderer paints that turn
    Then no turn separator is rendered for that turn

  @integration
  Scenario: A traced turn gets one separator regardless of message role
    Given the renderer is mounted in drawer variant
    And the conversation contains a user message rendered as a media item with a non-empty trace id
    When the renderer paints that turn
    Then a turn separator carrying that trace id renders above the media bubble
    # Unlike the old View Trace button (assistant-only), separators head every
    # traced turn — the trace covers the whole turn, not one side of it

  @integration
  Scenario: Grid variant suppresses turn separators on audio turns
    Given the renderer is mounted in grid variant
    And the conversation contains an assistant message rendered as a media item with a non-empty trace id
    When the renderer paints that turn
    Then no turn separator is rendered
    # Grid cards are previews — trace navigation lives in the drawer

  @integration
  Scenario: Transcript-collapse case renders one bubble with one turn separator
    Given the renderer is mounted in drawer variant
    And an assistant message contains both an audio part and a text-transcript part with a shared non-empty trace id
    When the renderer paints that turn
    Then exactly one bubble is rendered for that turn
    And exactly one turn separator is rendered above it

  @integration
  Scenario: Each distinct consecutive trace id group gets its own separator
    Given the renderer is mounted in drawer variant
    And the conversation contains assistant text, tool-call, and tool-result turns with distinct trace ids
    When the renderer paints those turns
    Then one turn separator renders per distinct consecutive trace id group
