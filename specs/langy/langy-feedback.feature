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
  # Structured directive + throttle: ask at the right time, not every time
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Langy asks for feedback at a high-signal moment via a hidden directive
    When Langy emits a hidden "[langy:feedback:frustrated]" directive in its reply
    Then the directive text is stripped from what I read
    And the feedback prompt is shown, tailored to a rough moment
    And it is shown even if the default throttle would otherwise suppress it

  @integration
  Scenario: The default affordance is throttled so it does not nag
    Given I gave feedback recently
    When Langy answers again without a feedback directive
    Then the default feedback affordance is not shown again yet

  @integration @unimplemented
  Scenario: A cheap model picks the moment and a stored last-asked time throttles it
    # Backend half (PR3): a cheap model classifies the moment (very good / very
    # bad / high / low friction) and emits the directive; a stored "last asked"
    # time per user throttles across turns and conversations.
    Given Langy is deciding whether to ask for feedback
    When the moment is high-signal and we have not asked recently
    Then Langy emits a feedback directive
    And the last-asked time is recorded so we do not ask again too soon
