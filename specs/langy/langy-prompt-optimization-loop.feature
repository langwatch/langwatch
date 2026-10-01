Feature: Langy runs the prompt improvement loop on the workbench
  As a non-technical owner of a prompt
  I want Langy to improve it against my evaluation data in measured steps
  So that I end with better numbers and my own work untouched

  # The loop is taught by skills/prompt-optimization/SKILL.mdx and executed
  # through the UI-action channel (specs/langy/langy-ui-actions.feature).
  # These scenarios run as judge-graded conversations against a live stack:
  # [gone] e2e/langy/langy-prompt-optimization.scenario.test.ts.
  # The scenario adapter attaches no browser tab, so every workbench action a
  # scenario exercises here takes the backend path by construction.

  Background:
    Given an evaluations experiment with a dataset, a prompt target and a mapped evaluator

  @e2e
  Scenario: Langy assesses the workbench state before touching anything
    When the user asks Langy to improve the prompt
    Then Langy reads the workbench state before any edit
    And the first mutation happens only after the state was read

  @e2e
  Scenario: With dataset, prompt target and evaluator present, Langy goes straight to improving
    When the user asks Langy to improve the prompt
    Then Langy states the current pass rate in one line
    And starts the loop without asking setup questions

  @e2e
  Scenario: Langy duplicates the baseline target and never edits the original
    When Langy runs the improvement loop
    Then every prompt edit lands on a duplicate column
    And the baseline target's prompt configuration is byte-identical afterwards

  @e2e
  Scenario: The duplicate carries evaluator mappings that resolve for the copy
    When Langy duplicates the baseline target
    Then the copy's evaluator mappings point at the copy's own output
    And no mapping still points at the baseline where the copy was meant

  @e2e
  Scenario: Langy grounds its hypothesis in actual failing rows
    When Langy proposes a prompt change
    Then the hypothesis names a concrete failure pattern from row-level results
    And a change with no named pattern does not happen

  @e2e
  Scenario: Langy runs a subset before the full dataset
    When Langy tests a new prompt draft
    Then the first run covers the failing rows or a small subset
    And the full dataset runs only after the subset improves

  @e2e
  Scenario: Langy runs the loop without asking permission to continue
    Given a dataset the experiment already holds
    When the loop starts
    Then Langy scores the baseline, duplicates, edits, runs and compares without asking permission to continue
    And it never asks whether it may run the next attempt

  @e2e
  Scenario: Langy asks about spending once, for the whole loop
    Given the dataset holds more than one hundred rows
    When the loop reaches its first run
    Then Langy states the row count and asks once, for the whole loop
    And later attempts run on that one answer

  @e2e
  Scenario: After an improvement short of the goal, Langy starts the next attempt itself
    When a candidate beats the baseline but falls short of the goal
    Then Langy forms the next hypothesis and runs the next attempt
    And it does not offer the user a choice about continuing

  @e2e
  Scenario: After a plateau, Langy spends an attempt on a different model
    When prompt edits stop improving the candidate
    Then Langy runs one duplicate on a different model
    And compares it as a cost and quality trade like any other attempt

  @e2e
  Scenario: Langy concludes with accuracy and cost deltas in a stats card
    When the loop reaches a stop condition
    Then the reply states the pass rate before and after and the cost change
    And a stats card carries the same numbers

  @e2e
  Scenario: Langy reports a tie or inconclusive comparison as what it is
    When the candidate and baseline end level
    Then Langy says the result is level rather than declaring a winner

  @e2e
  Scenario: Langy stops after three attempts that fail to beat the best candidate
    When three consecutive attempts fail to beat the best candidate
    Then Langy stops and reports what it tried
    And it offers the reader the choice of publishing the best draft or carrying on

  @e2e
  Scenario: Langy stops once it spends the attempt budget
    When six measured attempts have run and the goal is still not met
    Then Langy stops and reports the best result it found
    And it does not start a seventh attempt

  @e2e
  Scenario: A wrong golden answer is reported as a dataset problem, not prompt-fitted around
    Given a dataset row whose expected answer is wrong
    When Langy reads that row's failure
    Then Langy reports the golden answer as the problem
    And does not rewrite the prompt to reproduce the wrong answer

  @e2e
  Scenario: Progress is narrated before and after each run
    When Langy runs the improvement loop
    Then one short line before each run says what changed and why
    And one short line after says what the numbers did

  # Waiting used to be `sleep 30; langwatch experiment status`, one command that
  # prints nothing for half a minute. The panel showed the sleep as the work in
  # progress, and a turn that ended while it was open lost the run it was
  # waiting for. Waiting is the run's own command now.
  @unit
  Scenario: Waiting for a run returns as soon as the run reaches a terminal state
    Given a run that finishes while the caller is waiting for it
    When the caller asks for the status with a wait
    Then it answers as soon as the run is finished, without waiting out the limit

  @unit
  Scenario: Waiting for a run answers with the progress when the limit is reached
    Given a run still going when the wait limit is reached
    When the caller asks for the status with a wait
    Then it answers with how far the run has got, rather than failing

  @e2e
  Scenario: The user steps away and the loop continues on the backend
    Given no browser tab is attached to the workbench
    When Langy runs the improvement loop
    Then every action executes against the saved state
    And the loop completes without a browser

  # The other half of the loop: the same conversation with the workbench OPEN.
  # A page changes what the agent should say, not what it should do, so the end
  # state is asserted with the same helper the no-page suite uses and the words
  # are graded separately. Covered by
  # [gone] e2e/langy/langy-workbench-live.scenario.test.ts, which attaches
  # a headless stand-in for the page (see specs/langy/langy-ui-actions.feature,
  # "The browser leg is proven end to end against a live stack").

  @e2e
  Scenario: The loop runs in the page the user has open
    Given the user has the workbench open while Langy works
    When Langy runs the improvement loop
    Then the page carries the changes Langy asks for
    And the workbench ends in the same state it reaches with no page attached

  @e2e
  Scenario: The user closes the page mid-loop and the loop carries on
    Given Langy has already made changes through the open page
    When the user walks away and the page closes
    Then the rest of the loop executes against the saved state
    And no later action claims to have run in a page that is gone

  @e2e
  Scenario: Langy never says the page shows something it does not
    When Langy tells the user about a change it made
    Then it does not say the open page is showing a change the page is not showing
    And a place it names as where a change happened is where the change happened

  # The other half of the same idea. The two are graded apart so a run that
  # simply says nothing fails only this one, while a run that speaks and is
  # wrong fails the stricter invariant above.
  @e2e
  Scenario: Langy says where each change happened
    When a change ran in the page the user is watching
    Then Langy phrases it as something the user can watch happen
    And a change that ran that no page watched is described as one the page will pick up on reload

  @e2e
  Scenario: The recorded turn reads in the order it happened
    Given a turn that wrote text between its tool calls
    When the conversation is read back the way the panel reads it on reload
    Then the recorded turn holds more than one passage of text
    And text written before the last call is still in front of it
