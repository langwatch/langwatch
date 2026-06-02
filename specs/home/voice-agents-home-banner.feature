Feature: Voice agents home banner

  The home page surfaces project-level launch announcements through a
  single rotating banner slot. Once the traces-v2 banner is dismissed,
  the voice agents banner takes over the same slot until it too is
  dismissed. Each banner owns its own per-project snooze so dismissing
  one does not resurrect the other.

  Background:
    Given a logged-in user with a selected project

  Scenario: Voice banner is hidden by default while traces-v2 is still showing
    Given the traces-v2 home banner has never been dismissed for this project
    When the home page loads
    Then the traces-v2 banner is visible
    And the voice agents banner is not visible

  Scenario: Voice banner takes over once traces-v2 is snoozed
    Given the traces-v2 home banner is currently snoozed for this project
    And the voice agents banner has never been dismissed for this project
    When the home page loads
    Then the voice agents banner is visible
    And the traces-v2 banner is not visible
    And the banner shows the heading "Voice agent simulations are here"
    And the banner shows a "New" pill
    And the banner shows a "Try voice agent testing" call to action

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
