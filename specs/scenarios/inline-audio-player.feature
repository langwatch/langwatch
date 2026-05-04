Feature: Inline audio playback in the scenario message viewer
  As an engineer reviewing a voice-agent simulation in LangWatch
  I need an inline player whenever a message has an `input_audio` / `audio`
  content part
  So I can hear what was said without copy-pasting base64 into a tool.

  Background: tracking lw#3552. The Scenario SDK ships voice conversations
  via OpenAI-style multimodal content parts (`type: "input_audio"`,
  base64-encoded WAV). Without a player, the simulation viewer dumps the
  entire base64 blob inline as JSON.

  @unit
  Scenario: detects an OpenAI-style input_audio content part
    Given a message with content
      [{type: "input_audio", input_audio: {data: "<base64>", format: "wav"}}]
    When ScenarioMessageRenderer flattens the message
    Then the resulting items contain a single audio entry with
      src starting "data:audio/wav;base64,"

  @unit
  Scenario: detects an alternate-provider audio content part
    Given a message with content
      [{type: "audio", audio: {data: "<base64>", format: "mp3"}}]
    When ScenarioMessageRenderer flattens the message
    Then the resulting items contain an audio entry with
      src starting "data:audio/mp3;base64,"

  @unit
  Scenario: defaults format to wav when the SDK omits it
    Given a message with content
      [{type: "input_audio", input_audio: {data: "<base64>"}}]
    When ScenarioMessageRenderer flattens the message
    Then the audio entry's src starts "data:audio/wav;base64,"

  @unit
  Scenario: marks suspiciously short payloads as missing
    Given a message whose audio data field contains "x" (1 char)
    When ScenarioMessageRenderer flattens the message
    Then the resulting audio entry has missing=true

  @unit
  Scenario: keeps text alongside audio in mixed-content messages
    Given a message with content
      [{type: "text", text: "hi"}, {type: "input_audio", input_audio: {data: "<base64>", format: "wav"}}]
    When ScenarioMessageRenderer flattens the message
    Then the resulting items contain a text entry "hi" AND an audio entry
