# Trace tour — visibility and persistence
#
# Implementation:
#   langwatch/src/features/traces-v2/components/Toolbar/Toolbar.tsx          ("Show me around" control)
#   langwatch/src/features/traces-v2/onboarding/store/onboardingStore.ts     (seen flags + localStorage key)
#   langwatch/src/features/traces-v2/hooks/useIsNewAccount.ts                 (account age)
#
# Motivation (round 5): two tour papercuts.
#   1. "Seen the tour" is tracked per project (the localStorage state keys
#      the spotlight flags by projectId), so a user who took the tour in
#      one project gets prompted again in the next. It should be global to
#      the user.
#   2. The "Show me around" control shows its full text label for too long.
#      Established users don't need the words — just the icon.
#
# Decisions (round 5):
#   - Tour-seen is per-USER, stored in localStorage with the projectId
#     dropped from the key (global on that browser; no backend / no ADR).
#   - The text label shows only when the account is < 5 days old; older
#     accounts show the icon-only control.

Feature: Trace tour visibility and persistence

Rule: Tour-seen is global to the user, not per project
  Seeing or dismissing the tour suppresses the auto-tour across every
  project on that browser. The persisted state is not keyed by projectId.

  Background:
    Given the user is authenticated with "traces:view" permission

  Scenario: Seeing the tour in one project suppresses it in another
    Given the user has seen (or dismissed) the trace tour in project A
    When the user opens the traces page in project B
    Then the tour does not auto-start in project B

  Scenario: The tour seen state applies across projects on the same browser
    Given the user has seen (or dismissed) the trace tour in project A
    When the user opens the traces page in project B on the same browser
    Then the tour does not auto-start in project B

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
