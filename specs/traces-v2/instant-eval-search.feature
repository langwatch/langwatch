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

  # The run service, the table's progress and the refusal popover are the Instant Eval module's
  # own; they arrive with it. What is here is the search bar's half: the handover, how a chip is
  # spelled and keyed, and the four procedures the Explorer drives a run through.

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

  Rule: A run is keyed to the scope it judged

    @unit
    Scenario: The same question over the same scope shares one key
      Given a question, a target, the other chips of the query and an absolute window
      When the run key is computed twice
      Then the two keys are equal

    @unit
    Scenario: A change of range, target or other chips invalidates the key
      Given a run key for a question over a scope
      When the range, the target or one of the other chips changes
      Then the key is a different key

    @unit
    Scenario: A rolling preset does not re-run every tick
      Given a run key computed under the "Last 7 days" preset
      When the preset's bounds roll forward
      Then the key is the same key

    @unit
    Scenario: A chip forcing a unit is spelled by that unit's field
      Given a question whose target is not what the lens judges
      When the chip is spelled
      Then it carries the forcing field, quoted, and the bare field otherwise

  Rule: tRPC wraps the run service for the Explorer

    @unit
    Scenario: The Explorer's request becomes the shorthand
      Given a target, the other chips as the filter, an exact window and a question
      When the request is turned into the run service's input
      Then it is a shorthand with the window as ISO instants and one boolean question
      And the run's counters are answered in the Explorer's own shape

    @unit
    Scenario: A window outside the calendar range is refused as a validation error
      Given a request whose window bound is past what a date can represent
      When the request is validated
      Then it is refused as invalid input rather than raising while the instants are written

    @unit
    Scenario: A run judges the rows the Explorer shows
      Given the other chips name no origin
      When the request is turned into the run service's input
      Then the filter leaves out the Langy origin, as the table does
      And an eval chip of the query is not part of what the run judges
      And a request whose chips name an origin is left as asked
