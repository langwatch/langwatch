Feature: Voice message rendering regressions in simulation run UI
  As a user reviewing a simulation run that includes voice (audio) turns
  I want voice messages to render correctly regardless of part ordering and role
  So that I see one bubble per turn with correct alignment and no ghost artifacts

  Background:
    Given I am viewing a simulation run in the run detail drawer
    And the run's conversation includes voice message turns

  # ---------------------------------------------------------------------------
  # #4698 — text-first part ordering must collapse into a single bubble
  # The production SDK emits assistant voice turns text-first ([text, input_audio]);
  # earlier fixtures were audio-first ([input_audio, text]). Both orderings must
  # collapse into a single left-aligned bubble with the text as the transcript.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Both part orderings collapse a voice turn into one assistant bubble
    Given an assistant message contains an audio part and a text transcript part
    And the parts arrive in either text-first or audio-first order
    When the renderer paints that turn
    Then exactly one audio bubble is rendered for the turn
    And the text appears inside that same bubble as the transcript
    And the bubble aligns to the left (assistant side)

  # ---------------------------------------------------------------------------
  # #4698 — alignment inversion: user-role voice turns must align right
  # ---------------------------------------------------------------------------

  @integration
  Scenario: User-role voice turns align right
    Given a user voice message contains an audio part and a text transcript part
    When the renderer paints that turn
    Then the media bubble aligns to the right (user side)

  # ---------------------------------------------------------------------------
  # #4698 — audio-only assistant turn must not emit an empty transcript node
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Audio-only voice turn renders one bubble with no empty transcript artifact
    Given an assistant message contains only an audio part with no sibling text
    When the renderer paints that turn
    Then exactly one audio bubble is rendered
    And the bubble aligns to the left (assistant side)
    And no empty transcript node is rendered inside the bubble
