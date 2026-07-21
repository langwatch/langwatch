Feature: Langy asks for feedback at the right moments
  As the team improving Langy
  I want a modern, low-friction way to capture "how's Langy doing?"
  So that we learn from the highest-signal moments without nagging users

  # Frontend + capture contract for Langy feedback. Two ideas:
  #  1. A quiet, modern in-agent affordance (thumbs / "How's Langy doing?") that
  #     goes through the BACKEND (never client-side capture) — to PostHog for
  #     product analytics, and back into LangWatch itself as a feedback event on
  #     the conversation's trace so we dogfood Langy in our own account.
  #  2. Langy decides WHEN to ask, via a hidden structured directive in the
  #     stream (the same channel as [langy:connect-github] / [langy:progress]),
  #     so we ask at high-signal moments and throttle everything else.

  Background:
    Given I am signed in with Langy enabled for project "demo"
    And Langy has answered a message in the panel

  # ---------------------------------------------------------------------------
  # The affordance
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A quiet thumbs affordance sits under the latest reply
    Then a low-chrome "How's Langy doing?" with thumbs up / down shows under the latest reply
    And it only becomes prominent on hover

  @integration
  Scenario: Thumbs up records quietly through the backend
    When I click thumbs up
    Then the feedback is captured via the backend
    And the affordance collapses to a calm acknowledgement

  @integration
  Scenario: Thumbs down invites detail and offers a debug-consent
    When I click thumbs down
    Then I can add an optional note
    And I can consent to let the LangWatch team view the conversation to debug it
    When I send the feedback
    Then the note and the consent flag are captured via the backend

  # ---------------------------------------------------------------------------
  # Capture destinations
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Feedback flows into LangWatch itself, tied to the conversation trace
    When I submit feedback on a reply
    Then the feedback is recorded as a LangWatch feedback event on the conversation's trace id
    And it also lands in PostHog for aggregate product analytics
    And no feedback is captured directly from the browser

  # ---------------------------------------------------------------------------
  # Backend-driven cadence: the server decides when to ask
  # ---------------------------------------------------------------------------

  # The client never decides the moment on its own. The message-history read
  # carries an ask-for-feedback flag computed server-side from the conversation
  # depth and a per-user last-asked record, so the cadence holds across tabs,
  # devices, and reloads. Showing the ask counts as asking: ignoring the card
  # must not lead to it re-appearing under the next answer.

  @integration
  Scenario: Langy never asks under a conversation's first answer
    Given a conversation with exactly one assistant answer
    Then the feedback ask is not shown

  @integration
  Scenario: Langy asks once a conversation has a couple of answers
    Given a conversation with two or more assistant answers
    And I have not been asked for feedback recently
    Then the feedback ask is shown under the latest reply

  @integration
  Scenario: Showing the ask starts the quiet period even when it is ignored
    Given the feedback ask was shown to me
    And I neither rated nor dismissed it
    When Langy answers again, in this or any other conversation
    Then the feedback ask is not shown again for a few days

  @integration
  Scenario: A long conversation may ask once more despite the quiet period
    Given I was asked for feedback in a different conversation recently
    And the current conversation has grown well past a few answers
    Then the feedback ask may be shown once for this conversation
    And it is not shown again in this conversation afterwards

  @integration
  Scenario: Typing /feedback opens the rating card on demand
    When I send "/feedback" from the composer
    Then no message is sent to Langy
    And the rating card opens under the latest reply regardless of the cadence
    And rating or dismissing it behaves exactly as the asked card does

  @integration
  Scenario: Langy asks for feedback at a high-signal moment via a hidden directive
    When Langy emits a hidden "[langy:feedback:frustrated]" directive in its reply
    Then the directive text is stripped from what I read
    And the feedback prompt is shown, tailored to a rough moment
    And it is shown even if the default cadence would not ask
