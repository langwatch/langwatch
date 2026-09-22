Feature: Instant Evals inside the Trace Explorer

  As someone searching traces
  I want a sentence that needs a judgement of each trace to become an eval chip in the search bar
  So that the traces the judge matched show in the same table, with the same counts, as any other filter

  The shape:
  - A sentence Enter routes to a judgement is handed to the Explorer as a question, the unit
    judged, the explicit terms typed beside it and the phrase search to fall back to.
  - The run starts under a cost rule: an estimate first, then a start when the estimate is under
    half a dollar, and a confirm dialog otherwise.
  - Progress is visible on the table, matches appear as pages finish, and every refusal is a
    closable popover that leaves a phrase search behind, never an error state.

  # The chip, the run key, the run service, the table's progress and the refusal popover are the
  # Instant Eval module's own; they arrive with it. What is here is what the search bar owes the
  # run: the handover, and what the bar says while it is being made.

  Background:
    Given a project with traces in the window
    And the Instant Evals flag is on for the project
    And a classifier is configured

  Rule: A run starts under the cost rule

    @integration
    Scenario: A new search supersedes a pending Instant Eval
      Given an estimate for one sentence is still in flight
      When the reader submits anything else, a filter, a phrase or a question for the assistant
      Then the pending estimate is abandoned before the new search runs
      And it cannot come back, start a run and put its chip over what is now on screen
      And the dialog and the refusal popover close with it

    @unit
    Scenario: The bar names the step between Enter and the progress bar
      Given a sentence the router answered as an Instant Eval
      When the estimate is being made, and then the run is being started
      Then the search bar reads "Estimating the Instant Eval" and then "Starting the Instant Eval"
      And while the router decides it reads "Searching"
