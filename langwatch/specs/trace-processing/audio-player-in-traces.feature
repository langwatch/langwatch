Feature: Audio player in trace views

  Voice traces carry audio inside their message content. Both the legacy trace
  input/output view and the traces-v2 conversation view must surface that audio
  with an inline player, instead of only dumping the raw JSON payload on screen.

  Background:
    Given a trace whose message content carries an audio recording

  @integration
  Scenario: Legacy trace view plays an input_audio recording
    Given the recording is an OpenAI Realtime "input_audio" part
    When I open the trace in the legacy input/output view
    Then an inline audio player is shown for the recording

  @integration
  Scenario: Conversation view plays an input_audio recording
    Given the recording is an OpenAI Realtime "input_audio" part
    When I open the trace in the traces-v2 conversation view
    Then the message shows an inline audio player instead of raw JSON

  @integration
  Scenario: Both input_audio and AG-UI audio shapes are supported
    Given one message carries an OpenAI Realtime "input_audio" recording
    And another message carries an AG-UI "audio" recording
    When I view the trace
    Then each recording is shown with its own inline audio player
