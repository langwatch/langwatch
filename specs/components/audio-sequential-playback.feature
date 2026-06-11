Feature: Sequential Audio Playback in Scenario Run Viewers
  As a user reviewing a simulation run with multiple audio messages
  I want audio to play one at a time and advance automatically
  So that I can listen through a conversation without manual interaction

  Background:
    Given I am viewing a scenario run detail with audio messages

  # ============================================================================
  # Auto-advance (sequential chaining)
  # ============================================================================

  @integration
  Scenario: Audio auto-advances to the next audio item when the current one ends
    Given there are three audio messages in the conversation
    When I play the first audio message
    And the first audio message ends
    Then the second audio message starts playing automatically

  @integration
  Scenario: Chain continues from the second audio to the third
    Given there are three audio messages in the conversation
    When I play the second audio message
    And the second audio message ends
    Then the third audio message starts playing automatically

  @integration
  Scenario: Chain stops at the last audio message
    Given there are three audio messages in the conversation
    When the last audio message ends
    Then no further play is triggered

  @integration
  Scenario: Starting playback mid-list advances from that position onward
    Given there are three audio messages in the conversation
    When I play the second audio message
    And the second audio message ends
    Then the third audio message starts playing automatically
    And the first audio message is not affected

  @integration
  Scenario: Interleaved text items between audio messages are skipped during auto-advance
    Given there is an audio message followed by a text message followed by another audio message
    When the first audio message ends
    Then the second audio message starts playing automatically
    And the text message is not played

  # ============================================================================
  # Exclusivity (only one playing at a time)
  # ============================================================================

  @integration
  Scenario: Starting a new audio pauses any currently playing audio
    Given two audio messages are rendered in the same viewer
    And the first audio message is playing
    When I start the second audio message
    Then the first audio message is paused

  @integration
  Scenario: No audio plays on initial render without user interaction
    Given audio messages are rendered in the viewer
    When the viewer first appears
    Then no audio is playing

  # ============================================================================
  # Instance isolation (grid cells are independent)
  # ============================================================================

  @integration
  Scenario: Playing audio in one renderer instance does not pause audio in another instance
    Given two separate renderer instances each have an audio message
    When audio plays in the first renderer instance
    Then audio in the second renderer instance is not paused

  # ============================================================================
  # Error resilience
  # ============================================================================

  @integration
  Scenario: A failed play() during auto-advance does not throw an unhandled rejection
    Given there are two audio messages in the conversation
    And the second audio message cannot be loaded
    When the first audio message ends
    Then no unhandled promise rejection occurs
    And the chain stops gracefully

  @integration
  Scenario: The last audio ending does not trigger any further play
    Given there is a single audio message in the conversation
    When that audio message ends
    Then play is not called again
