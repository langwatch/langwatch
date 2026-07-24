Feature: Voice agents home banner

  The home page surfaces project-level launch announcements through a
  single banner slot that holds exactly ONE banner at a time. While both
  the traces-v2 and voice agents launches are still un-dismissed, the
  slot picks between them at random (50/50, per mount). Once one of the
  two is snoozed, the other takes the slot deterministically. Each
  banner owns its own per-project snooze so dismissing one does not
  resurrect the other.

  Background:
    Given a logged-in user with a selected project

  Scenario: Random pick between traces-v2 and voice when neither is snoozed
    Given neither the traces-v2 nor the voice agents banner has been dismissed for this project
    When the home page loads
    Then exactly one of the two banners is visible
    And the choice is stable for the lifetime of that mount

  Scenario: Voice banner is forced when only traces-v2 is snoozed
    Given the traces-v2 home banner is currently snoozed for this project
    And the voice agents banner has never been dismissed for this project
    When the home page loads
    Then the voice agents banner is visible
    And the traces-v2 banner is not visible
    And the banner shows the heading "Voice agent simulations are here"
    And the banner shows a "New" pill
    And the banner shows a "Try voice agent testing" call to action

  Scenario: Traces-v2 banner is forced when only voice agents is snoozed
    Given the voice agents banner is currently snoozed for this project
    And the traces-v2 banner has never been dismissed for this project
    When the home page loads
    Then the traces-v2 banner is visible
    And the voice agents banner is not visible

  Scenario: Neither banner renders when both are snoozed
    Given both the traces-v2 and voice agents banners are currently snoozed for this project
    When the home page loads
    Then no announcement banner is visible

  Scenario: CTA opens the public docs in a new tab
    Given the voice agents banner is visible
    When the user clicks the "Try voice agent testing" CTA
    Then a new browser tab opens at https://langwatch.ai/scenario/voice/getting-started
    And the link uses rel="noopener noreferrer"
    And a "voice_agents_banner_click" PostHog event is captured with surface "home_banner"

  Scenario: Dismissing snoozes the voice banner for 7 days
    Given the voice agents banner is visible
    When the user clicks the dismiss "x" button
    Then the voice agents banner is hidden immediately
    And the snooze persists under storage key "langwatch:voice-agents-home-banner-dismissed:v1:<projectId>"
    And the stored value expires roughly 7 days in the future

  Scenario: Snooze is scoped per project
    Given the voice agents banner has been dismissed for project A
    And the user switches to project B in the same organization
    When the home page loads under project B
    Then the voice agents banner is visible for project B

  Scenario: SSR/pre-hydration does not flash either banner
    When the home page renders on the server
    Then neither the voice agents banner nor the traces-v2 banner appears in the SSR output
    And both banners only mount after client-side hydration

  Scenario: Dismissing the currently-shown banner hands the slot to the other in the same tab
    Given both banners are eligible and the random pick rendered the voice agents banner
    When the user clicks the dismiss "x"
    Then the voice agents banner is hidden immediately
    And the traces-v2 banner takes the slot without a page reload
