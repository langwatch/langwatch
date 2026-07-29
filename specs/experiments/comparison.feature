Feature: Comparison evaluator (pairwise or multi-candidate preference judging)
  # Issues: #5100 (pairwise), #5101 (n-way), unified here
  # Parent epic: #5099
  #
  # One evaluator that compares 2 or more prior columns and picks the best
  # per row, against an optional golden reference. Comparing two candidates
  # is not a different feature from comparing five, so there is exactly one
  # "Comparison" card, one config form, and one result column.
  #
  # Supersedes the earlier split into "Pairwise Compare" and "N-way Compare"
  # cards. Backed by langevals/select_best_compare, which handles N=2.
  #
  # The legacy langevals/pairwise_compare evaluator type is never offered when
  # creating something new, and its own langevals endpoint is never called by
  # the app again. Execution for a row whose saved evaluator config still
  # carries the legacy type is transparently rerouted to select_best_compare,
  # with its two-slot config translated into the N-way shape first — so
  # existing experiments and monitors keep working, and the app only ever
  # talks to one judge.

  Background:
    Given an EvaluationsV3 experiment with target variants "variant_1", "variant_2", "variant_3"
    And a dataset with rows having "input" and "expected_output" fields
    And each target has run on all rows producing outputs and metadata

  Scenario: Comparison is offered as a single card
    When I open Add to Evaluation
    Then I see one "Comparison" card
    And I do not see a separate "Pairwise Compare" card
    And I do not see a separate "N-way Compare" card

  # A comparison is defined by which of THIS experiment's columns it compares.
  # Created anywhere else there is nothing to compare, so the only door into
  # it is the one that can show the columns.
  Scenario: Comparison is only created where its columns are visible
    When I open the evaluator catalog and choose "LLM as Judge"
    Then I do not see a "Comparison" card
    But adding a Comparison from Add to Evaluation opens the form with the variant picker

  # A comparison is a saved evaluator, so it gets the same list-then-create flow
  # as Prompt, Agent and Evaluator — the same list component, narrowed to
  # comparison evaluators.
  Scenario: Comparison offers the ones I already have
    Given I have already saved a comparison evaluator
    When I choose Comparison from Add to Evaluation
    Then I see it listed, alongside a "New Comparison" button

  Scenario: Selecting a saved comparison adds it as a column
    Given I am looking at the list of saved comparisons
    When I select one
    Then it is added as a Comparison column
    And its config form opens so I can pick the variants for this experiment

  # Variants are target ids belonging to THIS experiment, so a saved comparison
  # carries a judge and its settings, never the columns it compared elsewhere.
  Scenario: New Comparison starts blank
    Given a comparison already exists in this evaluation
    When I choose Comparison and click "New Comparison"
    Then the form opens with no variants selected
    And creating it adds a second Comparison column

  # Every other evaluator is edited by clicking its chip, but comparisons are
  # filtered out of the chip lists — they grade no single target.
  Scenario: The Comparison column header opens its config
    Given a Comparison column exists
    When I click the column's title
    Then its config form opens, with the current variants selected

  # The Comparison card collects the variants before Create, so by the time the
  # column is added there is nothing left to configure. Re-opening the config
  # form on top of it reads as the drawer refusing to close.
  Scenario: Creating a configured Comparison closes the drawer
    Given I have added a Comparison from Add to Evaluation
    And I have selected two variants
    When I create it
    Then the Comparison column is added
    And the drawer closes

  # Picking a comparison judge straight off the evaluator list skips the card,
  # so it arrives with no variants and cannot judge anything yet.
  Scenario: Creating an unconfigured Comparison opens its config form
    Given I pick a comparison evaluator with no variants selected
    When it is added as a column
    Then its config form opens so I can pick the variants

  Scenario: Compare two variants
    When I add a Comparison evaluator
    And I select targets "variant_1", "variant_2" as the variants to compare
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with the comparison config
    And the comparison has 2 variants

  Scenario: Compare three variants
    When I add a Comparison evaluator
    And I select targets "variant_1", "variant_2", "variant_3" as the variants to compare
    And I select dataset field "expected_output" as Golden
    Then the evaluator is saved with the comparison config
    And the comparison has 3 variants

  Scenario: At least two variants must be selected
    When I add a Comparison evaluator
    And I select only one variant
    Then the evaluator cannot be saved until a second variant is selected

  Scenario: Run produces one verdict per row from a single judge call
    Given a Comparison evaluator is configured with three variants and default settings
    When I run the evaluator
    Then for each row a row-level verdict result is produced from exactly one judge call
    And each result has a label equal to the winning candidate's identifier or "tie"
    And each result has a reasoning string

  Scenario: The verdict names only the winner
    Given a Comparison evaluator is configured with three variants
    And a row has been evaluated with "variant_2" winning
    When I view the Comparison column for that row
    Then I see "variant_2" named as the winner
    And I do not see the losing variants listed alongside it

  Scenario: Clicking the winner highlights its source column
    Given a Comparison verdict names "variant_2" as the winner
    When I click on the winner's name
    Then "variant_2"'s source column is highlighted and marked as having won
    And clicking the winner's name again clears the highlight

  Scenario: Candidate order is shuffled deterministically per row
    Given a Comparison evaluator is configured with five variants
    When the same row is evaluated twice
    Then the candidate order presented to the judge is identical both times

  Scenario: A row with a missing candidate output is skipped
    Given a Comparison evaluator is configured with three variants
    And one variant produced no output for a row
    When that row is evaluated
    Then no verdict is produced for that row
    And the row reports which variant it was waiting on

  # The header names the overall outcome and nothing more — an exact count
  # ("variant_1 wins 14") is a number without a denominator, and dogfood found
  # it read as noise. The per-variant breakdown belongs on the results page,
  # where there is room to chart it.
  Scenario: Column header names the overall winner
    Given 30 rows have been evaluated where variant_1 wins 14, variant_2 wins 10, variant_3 wins 4, and 2 ties
    When I view the Comparison column header
    Then I see that "variant_1" wins
    And hovering it reveals the win tally broken down per variant, including ties

  Scenario: Column header reports a tie when no variant leads
    Given 4 rows have been evaluated where variant_1 wins 2 and variant_2 wins 2
    When I view the Comparison column header
    Then I see "Tied"

  Scenario: Results page charts the win rate per variant
    Given 30 rows have been evaluated where variant_1 wins 14, variant_2 wins 10, variant_3 wins 4, and 2 ties
    When I view the run on the results page
    Then the win-rate chart has one bar per variant plus a bar for ties
    And every variant's wins are counted, including the third

  Scenario: A variant that never wins still appears
    Given a Comparison evaluator ran with three variants and "variant_3" never won a row
    When I view the run on the results page
    Then "variant_3" is still shown, with zero wins

  # Customer feedback, 2026-07-08 call: reusing the same prompt as two
  # variants (e.g. re-testing gpt-4.1 vs gpt-5-mini) made them
  # indistinguishable in the scoreboard and per-row verdicts. What differs
  # between two same-name variants isn't always the model (could be
  # temperature, a prompt edit, anything) — so this doesn't guess a
  # differentiator, it just numbers them.
  Scenario: Same-name variants fall back to numbering
    Given two variants are both named "AI search system"
    When I view the Comparison column header or a row verdict
    Then the first is shown as "AI search system (1)"
    And the second is shown as "AI search system (2)"

  # Issue: #5378
  # Golden answer is opt-in, not mandatory — some datasets have no reference
  # answer, and picking a fake golden field (like "input") misframes the
  # judge prompt as golden-aware when it isn't.
  Scenario: Has Golden Answer is on by default
    When I add a Comparison evaluator
    Then Has Golden Answer is toggled on
    And a Golden field picker is shown

  Scenario: Turning off Has Golden Answer hides the Golden field picker
    Given a Comparison evaluator is configured with default settings
    When I toggle Has Golden Answer off
    Then no Golden field picker is shown
    And the evaluator can be saved without a golden field selected

  Scenario: Judge prompt drops golden framing when Has Golden Answer is off
    Given Has Golden Answer is toggled off
    And the prompt has not been customized by the user
    When a row is evaluated
    Then the rendered judge prompt contains no "golden answer" framing
    And the judge compares the candidates on their own merits

  Scenario: Judge prompt keeps golden framing when Has Golden Answer is on
    Given Has Golden Answer is toggled on (default)
    When a row is evaluated
    Then the rendered judge prompt asks the judge to compare the candidates against the golden answer

  Scenario: Structured outputs can be narrowed to a single field per variant
    Given "variant_1" produces a structured output with fields "answer" and "confidence"
    When I select "answer" as the output field to compare for "variant_1"
    Then only that field's value is presented to the judge as that candidate's output

  # Each variant chooses its own field. Two variants may name the same answer
  # differently — one calls it "answer", another "reply" — and only the user
  # knows they mean the same thing. Nothing forces the choice to be uniform.
  Scenario: Each variant chooses its output field independently
    Given "variant_1" and "variant_2" both produce structured outputs
    When I select "answer" for "variant_1"
    Then "variant_2"'s output field is unchanged

  # A plain prompt declares exactly one output field, so a picker there would
  # be a dropdown with one option.
  Scenario: No field picker when a variant has only one output field
    Given "variant_1" produces a single output field
    When I view its variant card
    Then no output field picker is shown
    And its whole output is presented to the judge

  Scenario: A structured output with no field selected still judges
    Given "variant_1" produces a structured output with fields "answer" and "confidence"
    And I have not chosen an output field for "variant_1"
    When I run the comparison
    Then the whole output is presented to the judge as text
    And the run does not fail

  # The variants used to reflow ragged: twelve of them landed as 4/4/3/1 and
  # the lone trailing card read as a mistake.
  Scenario: Variants are laid out in even rows
    When I pick 12 variants
    Then they are laid out 4 to a row
    When I pick 9 variants
    Then they are laid out 3 to a row
    When I pick 7 variants
    Then they are laid out 4 to a row, then 3

  # Back-compat. Experiments created before the merge stored a two-slot
  # `pairwise` config (variantA / variantB) and, on older runs, verdict
  # labels of "A" / "B" rather than the winning candidate's identifier.
  # These are read and normalized on load; they are never written again.
  Scenario: A saved pairwise experiment loads as a Comparison
    Given a saved experiment whose evaluator carries the legacy pairwise config
    When I open the experiment
    Then it renders as a single Comparison column with 2 variants
    And re-running it produces verdicts without error

  Scenario: Legacy slot labels still name a winner
    Given a saved experiment with a stored verdict whose label is "A"
    When I view the Comparison column for that row
    Then the first variant is named as the winner

  # #5528 postmortem: an earlier attempt changed the dispatched judge type in
  # one place (the orchestrator) while the payload shape was decided in
  # another, so a 2-slot payload could reach the N-way judge. The fix here is
  # to leave every upstream caller (the orchestrator, a monitor's scheduled
  # run) emitting the exact 2-slot shape it always has, and do BOTH the
  # reroute and the payload translation at ONE interception point — the
  # legacy evaluations route. Type and payload move together at a single
  # site, so they cannot drift apart again.
  Scenario: Existing pairwise monitors keep running
    Given a monitor configured with the legacy "langevals/pairwise_compare" evaluator
    When the monitor runs
    Then it is dispatched to select_best_compare with the config translated to the N-way shape
    And it evaluates successfully
    And the result carries the winning candidate's identifier, not a slot letter

  Scenario: A legacy pairwise experiment's structured-output field selection survives translation
    Given a saved pairwise experiment where "variantA" is narrowed to output field "answer"
    When a row is re-run
    Then the judge sees only the "answer" field for that variant, not its whole structured output
