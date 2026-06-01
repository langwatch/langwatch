Feature: AICreateModal test isolation keeps the close-button query reliable
  As a LangWatch engineer
  I want each AICreateModal test to render against a clean DOM
  So that the close-button query stops flaking CI-only when leaked dialogs get aria-hidden

  # Context (issue #4467): AICreateModal.test.tsx failed CI-only on
  # `getByRole("button", { name: /close/i })` with "Unable to find role=button".
  # Root cause is test isolation, NOT the component: vitest runs without
  # `globals: true`, so @testing-library/react's automatic per-test cleanup never
  # registers. Without it every render() leaks its portaled Chakra Dialog into
  # document.body; accumulated dialogs get aria-hidden by focus management, and
  # role-based queries (getByRole/getAllByRole) exclude aria-hidden elements — so
  # the close button intermittently can't be found. Fix is test-only: add
  # `afterEach(cleanup)` so exactly one live, non-aria-hidden dialog exists per test.

  # AC1 — the previously-flaky close-button query resolves in the error state
  @unit
  Scenario: Close button is present after generation fails
    Given the modal is rendered open and generation is triggered
    And generation fails so the modal enters its error state
    Then a button with the accessible name matching /close/i is found in the dialog

  # AC2 (part 1) — an open modal mounts exactly one live dialog
  @unit
  Scenario: An open modal renders a dialog into the document
    Given the modal is rendered open
    Then a dialog is present in the document

  # AC2 (part 2) — per-test cleanup prevents dialog accumulation / aria-hidden pollution
  @unit
  Scenario: A new test starts with a clean DOM after the previous dialog is unmounted
    Given a previous test rendered the modal
    When the suite's afterEach cleanup has run
    Then no dialog from the previous test remains in the document

  # --- AC Coverage Map ---
  # AC1: "Failing assertion fixed — the close-button query resolves in the error state"
  #      → Scenario: Close button is present after generation fails
  # AC2: "Per-test cleanup — afterEach(cleanup) keeps one live dialog and leaves a clean DOM between tests"
  #      → Scenario: An open modal renders a dialog into the document
  #      → Scenario: A new test starts with a clean DOM after the previous dialog is unmounted
  # AC3: "Test-only change — AICreateModal.tsx / ui/dialog.tsx / ui/close-button.tsx untouched"
  #      → verified by diff (git diff shows only the test + this spec changed); not a runtime scenario
  # AC4: "Reliable green — passes consistently across repeated runs"
  #      → verified by /prove-it + CI (10× local green, plus the test-unit shard on this PR); not a single-test scenario
