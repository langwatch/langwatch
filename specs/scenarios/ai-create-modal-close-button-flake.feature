Feature: AICreateModal tests are isolated so the close-button query stays reliable
  As a LangWatch engineer
  I want each AICreateModal test to render against a clean DOM
  So that the close-button assertion stops flaking CI-only when leaked dialogs get aria-hidden

  # Context (issue #4467): AICreateModal.test.tsx failed CI-only on
  # `getByRole("button", { name: /close/i })` with "Unable to find role=button".
  # Root cause is test isolation, NOT the component: vitest runs without
  # `globals: true`, so @testing-library/react's automatic per-test cleanup never
  # registers. Without it, every render() leaks its portaled Chakra Dialog into
  # document.body. As dialogs accumulate across the file's cases, focus management
  # marks them aria-hidden/inert, and role-based queries (getByRole/getAllByRole)
  # exclude aria-hidden elements — so the close button (and sometimes the dialog
  # itself) intermittently can't be found. The component is correct and unchanged:
  # the icon-only Dialog.CloseTrigger carries aria-label="Close" (present since
  # 2026-04-08). The fix is test-only — add `afterEach(cleanup)` so exactly one
  # live, non-aria-hidden dialog exists per test.

  Background:
    Given the AICreateModal test suite renders and tears down the modal across many cases

  # AC1 — the previously-failing assertion passes reliably within the full suite
  @unit
  Scenario: Close button is found in the error state even late in the suite
    Given several earlier cases have already rendered and finished with the modal
    When a later case drives the modal into its error state
    Then a button with the accessible name matching /close/i is found in the dialog
    And no "Unable to find role=button and name /close/i" error occurs

  # AC2 — per-test cleanup prevents dialog accumulation / aria-hidden pollution
  @unit
  Scenario: Each test starts from a clean DOM with a single live dialog
    Given a case has rendered the modal and finished
    When the next case renders the modal
    Then no dialog from the previous case remains in the document
    And the newly rendered dialog is the only one and is not aria-hidden

  # AC3 — the production component is untouched; the /close/i contract is the
  # component's own and the fix lives entirely in the test setup
  @unit
  Scenario: The fix changes only the test, not the component
    Given the AICreateModal, Dialog, and CloseButton sources are not modified
    When the open modal renders its close trigger
    Then the close trigger's accessible name matches /close/i
    And the match comes from the component's existing aria-label, not a test change

  # AC4 — the fix is reliable: isolation makes the close-button query deterministic
  @unit
  Scenario: Close-button query stays green across repeated runs
    Given the AICreateModal test file is run repeatedly
    When every case renders against a clean DOM
    Then the close button is found on every run with no intermittent flake

  # --- AC Coverage Map ---
  # AC1: "Failing assertion fixed — the close-button query passes reliably within the full suite, even for cases that run after many prior renders"
  #      → Scenario: Close button is found in the error state even late in the suite
  # AC2: "Per-test cleanup in place — afterEach(cleanup) runs after every test so leaked portaled dialogs cannot accumulate and get aria-hidden; each test sees one live dialog"
  #      → Scenario: Each test starts from a clean DOM with a single live dialog
  # AC3: "Test-only change — AICreateModal.tsx, ui/dialog.tsx, and ui/close-button.tsx are untouched; the production component is not modified"
  #      → Scenario: The fix changes only the test, not the component
  # AC4: "Reliable green — the full suite passes and the close-button assertion passes consistently across repeated runs"
  #      → Scenario: Close-button query stays green across repeated runs
