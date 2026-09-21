Feature: Prompt optimization entry points
  The workbench hands a prompt column to Langy in one gesture, and the
  handoff carries the context Langy needs to run the improvement loop.

  Background:
    Given an evaluations workbench with a prompt target column

  @integration
  Scenario: The prompt column menu offers Optimize this prompt on prompt targets only
    When the user opens a prompt column's menu
    Then "Optimize this prompt" is the first item
    And an evaluator column's menu does not offer it

  @integration
  Scenario: Choosing Optimize opens the Langy panel and auto-sends the optimize request
    When the user chooses "Optimize this prompt"
    Then the Langy panel opens
    And the optimize request is queued to send without further typing
    And the request names the column and tells Langy to work on a duplicate

  @integration
  Scenario: The optimize handoff carries the experiment and prompt context chips
    When the user chooses "Optimize this prompt"
    Then Langy works on the experiment the user came from, with nothing to pick
    And Langy has the column's prompt in front of it, with nothing to attach

  @e2e
  Scenario: From anywhere, improving a prompt with no experiment sets one up and navigates there
    Given the user has a prompt but no experiment for it
    When the user asks Langy to improve that prompt
    Then Langy creates an evaluations experiment with the prompt as a target
    And navigates the user to the workbench before the first run

  # The scenarios below are verified by browser QA (Playwright, a real tab on
  # the workbench) rather than by a bound test: each needs a live browser
  # observing the page while the agent edits, which no vitest lane provides.
  # See the browser QA plan in the PR that ships this feature.

  Scenario: A returning tab catches up on Langy's edits without a manual reload
    Given Langy changed the experiment while the tab was hidden
    When the user returns to the tab with no unsaved edits
    Then the workbench reloads to the latest version silently

  Scenario: Langy's live edits are undoable with the ordinary undo
    Given Langy applied an action in the open workbench
    When the user presses undo
    Then the agent's change reverts like any of their own

  Scenario: The page shows that an agent edit happened
    Given Langy applied an action in the open workbench
    Then the change is visible where the user is looking
    And the version history attributes the change to Langy
