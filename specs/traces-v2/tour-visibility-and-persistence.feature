# Trace tour — visibility and persistence
#
# Implementation:
#   langwatch/src/features/traces-v2/components/Toolbar/Toolbar.tsx          ("Show me around" control)
#   langwatch/src/features/traces-v2/onboarding/store/onboardingStore.ts     (seen flags + localStorage key)
#   langwatch/src/features/traces-v2/hooks/useIsNewAccount.ts                 (account age)
#
# Motivation: two tour papercuts.
#   1. Tour dismissal must follow the authenticated user across projects,
#      browsers, and devices instead of depending on browser-local state.
#   2. The "Show me around" control shows its full text label for too long.
#      Established users don't need the words — just the icon.
#
# Decisions:
#   - Tour dismissal is persisted on the User record in Postgres.
#   - Any explicit dismissal, including Skip tour, close, Escape, Done, or
#     the toolbar's End tour action, suppresses automatic page and drawer
#     spotlights for that user.
#   - The explicit "Show me around" action can still replay the page tour.
#   - The text label shows only when the account is < 5 days old; older
#     accounts show the icon-only control.

Feature: Trace tour visibility and persistence

Rule: Tour dismissal is global to the user, not per project or browser
  Dismissing the tour suppresses automatic page and drawer spotlights across
  every project and device. The persisted state is not keyed by projectId.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Dismissing the tour in one project suppresses it in another
    Given the user dismissed the trace tour in project A
    When the user opens the traces page in project B
    Then the tour does not auto-start in project B

  Scenario: Tour dismissal follows the user to another browser
    Given the user dismissed the trace tour in one browser
    When the same user opens the traces page in another browser or device
    Then neither the page tour nor drawer spotlights appear automatically

  Scenario: Existing browser tour history is migrated to the user preference
    Given the browser recorded a trace tour under the previous local behavior
    And the user does not have a persisted dismissal yet
    When the traces page loads the user preference
    Then the existing tour history is persisted for the authenticated user
    And newly displayed tour steps are not mistaken for old history

  Scenario: Skip tour dismisses every automatic Traces Explorer tour
    Given a page or drawer spotlight is visible
    When the user selects "Skip tour"
    Then the dismissal is persisted for the authenticated user
    And all remaining automatic Traces Explorer spotlights are suppressed

  Scenario: Ending an active tour from the toolbar persists dismissal
    Given the page spotlight tour is active
    When the user selects "End tour" in the toolbar
    Then the dismissal is persisted for the authenticated user
    And the active tour closes

  Scenario: Preference loading never flashes an unwanted tour
    Given the persisted dismissal has not finished loading
    When the traces page or a trace drawer renders
    Then automatic spotlights remain hidden until the preference is resolved

  Scenario: Explicit replay remains available after dismissal
    Given the user previously dismissed automatic Traces Explorer tours
    When the user selects "Show me around"
    Then the page tour starts explicitly

Rule: "Show me around" collapses to an icon for established accounts
  The control always starts the tour on click; only its text label is
  age-gated.

  Background:
    Given the user is authenticated with "traces:view" permission
    And the "Show me around" control is rendered in the toolbar

  Scenario: New account sees the text label
    Given the account was created less than 5 days ago
    Then the control shows the "Show me around" text label

  Scenario: Established account sees the icon only
    Given the account was created 5 or more days ago
    Then the control shows the icon only (no text label)
    And clicking it still starts the tour

  Scenario: The active-tour control is unaffected by age
    Given the tour is currently running
    Then the control shows its "End tour" affordance regardless of account age
