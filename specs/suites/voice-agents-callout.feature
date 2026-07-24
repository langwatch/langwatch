Feature: Voice agents callout in simulations sidebar

  The simulations sidebar surfaces a small gradient announcement card
  pinned at the bottom, just above the collapse-toggle footer. It
  invites users to try voice agent simulations and routes to the public
  Scenario docs. The card disappears for 14 days once dismissed and
  never renders when the sidebar is collapsed (no room for copy).

  Background:
    Given a logged-in user with a selected project
    And the user is on the /simulations page

  Scenario: Callout is visible by default at the bottom of the expanded sidebar
    Given the simulations sidebar is expanded
    And the voice agents callout has never been dismissed for this project
    When the sidebar renders
    Then the voice agents callout is visible
    And it is positioned just above the collapse-toggle footer
    And it shows the title "Try voice agent simulations"
    And it shows a "Get started" arrow CTA

  Scenario: Callout is hidden when the sidebar is collapsed
    Given the simulations sidebar is collapsed to the icon rail
    When the sidebar renders
    Then the voice agents callout is not visible

  Scenario: Clicking the callout opens the public docs in a new tab
    Given the voice agents callout is visible
    When the user clicks the callout body
    Then a new browser tab opens at https://langwatch.ai/scenario/voice/getting-started
    And the link uses rel="noopener noreferrer"
    And a "voice_agents_callout_click" PostHog event is captured with surface "simulations_sidebar"

  Scenario: Dismissing the callout snoozes it for 14 days
    Given the voice agents callout is visible
    When the user clicks the dismiss "x" button
    Then the callout is hidden immediately
    And the dismiss click does not navigate to the docs link
    And the snooze persists under storage key "langwatch:simulations-voice-callout-dismissed:v1:<projectId>"
    And the stored value expires roughly 14 days in the future

  Scenario: Snooze is scoped per project
    Given the voice agents callout has been dismissed for project A
    And the user switches to project B in the same organization
    When the /simulations page loads under project B
    Then the voice agents callout is visible for project B

  Scenario: SSR/pre-hydration does not flash the callout
    When the simulations sidebar renders on the server
    Then the voice agents callout does not appear in the SSR output
    And it only mounts after client-side hydration
