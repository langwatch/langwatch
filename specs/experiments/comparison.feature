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

  # A verdict too long for its cell expands over the table behind a
  # full-viewport backdrop. An overlay that only closes on an outside click
  # leaves the reader stranded: the backdrop keeps swallowing pointer events,
  # so the toolbar above the table stops responding until they happen to click
  # the backdrop itself.
  @integration
  Scenario: Dismissing an expanded verdict
    Given a Comparison verdict too long to fit its cell
    When I click the cell to read all of it
    Then the verdict expands over the table
    And it tells me it closes on an outside click or on Escape
    When I press Escape
    Then the expanded verdict closes and the table is clickable again

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

  # Dogfood, on a run of 4, 0 and 3 wins: the "3" showed above its bar and the
  # winner's "4" showed nowhere. The leading bar is as tall as the chart allows,
  # so its count was drawn past the top edge and cut off, leaving the one tally
  # the reader came for as the only one missing. The room for it is reserved as
  # a fixed strip of the chart rather than by stretching the axis, which would
  # give back less and less room as the counts climb.
  @integration
  Scenario: The leading candidate's win count stays legible
    Given 30 rows have been evaluated where variant_1 wins 14, variant_2 wins 10, variant_3 wins 4, and 2 ties
    When I view the win-rate chart on the results page
    Then I can read "14" above variant_1's bar
    And I can read it just as well on a run ten times longer

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
  # judge prompt as golden-aware when it isn't. The choice lives in the
  # Golden field picker itself: it defaults to "None — judge on merits", or
  # pick a dataset column to compare candidates against it instead.
  Scenario: Judging candidates on their own merits is the default
    When I add a Comparison evaluator
    Then the comparison judges candidates on their own merits
    And a Golden field picker is shown, defaulted to "None — judge on merits"
    And the evaluator can be saved without a golden field selected

  Scenario: Choosing a golden field compares candidates against it
    Given a Comparison evaluator is configured with default settings
    When I choose a dataset column for the Golden field
    Then the comparison expects a golden answer
    And the judge compares each candidate against that golden answer

  Scenario: Comparison judges candidates on their own merits without a golden answer
    Given the comparison is set to judge on merits, with no golden answer
    And the prompt has not been customized by the user
    When a row is evaluated
    Then the judge picks a winning candidate on quality alone, with no reference answer involved

  Scenario: Comparison uses the golden answer when one is set
    Given the comparison compares against a golden answer
    And the prompt has not been customized by the user
    When a row is evaluated
    Then the judge picks a winning candidate based on how well it matches the golden answer

  # The config form decides whether a prompt is still a shipped default by
  # comparing it against its own copies of the four templates. If those
  # copies drift from the judge's, the form stops recognizing an untouched
  # prompt, silently turns off the adaptation above, and a golden-free
  # comparison ships a prompt framed around a reference answer that isn't
  # there. Nothing about that failure is visible, so the copies are pinned.
  @unit
  Scenario: The shipped judge prompts are identical wherever they are written down
    Then every default judge prompt the config form knows is byte-identical
      to the judge's own

  # The judge also adapts to whether the row itself carries task context: a
  # row that hands the judge a task is framed around it, while a row with no
  # task context is judged without it, so the judge is never handed an empty
  # instruction. This is decided per row at run time, independently of the
  # golden-answer choice above.
  Scenario: Comparison evaluates rows with or without task context
    Given a Comparison evaluator whose prompt the user has not customized
    When a row provides task context
    Then the judge compares the candidates against that task and picks a winner
    When a row provides no task context
    Then the judge still compares the candidates and picks a winner

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

  # The judge is shown anonymized slot labels so a candidate's name cannot
  # sway it, which leaves it arguing about "A", "B" and "C". A verdict reading
  # "Winner: variant_2" above a paragraph about "Candidate C" puts the most
  # useful half of a comparison in a code the reader has no key for, so the
  # reasoning is translated with the same mapping the winner is.
  @unit
  Scenario: The verdict reasoning names candidates, not slot letters
    Given a Comparison evaluator has judged a row with three variants
    When the judge explains its pick as "Candidate C", or as "candidate c"
    Then the reasoning I read names that variant in place of the letter

  # The reasoning is customer-facing prose, so a substitution that corrupts a
  # sentence is worse than a slot letter left standing. Three collisions
  # matter: the English article, a quoted letter, which is usually a
  # multiple-choice answer the candidate gave, and a letter that is part of a
  # longer name, which is what "C++" is to a reader.
  @unit
  Scenario: Reasoning prose survives the slot translation
    Given the judge's explanation opens with "A concise answer is better"
    When I read the reasoning
    Then that sentence is untouched
    And a letter that was never one of this row's slots is untouched
    And an explanation that mentions no slot at all is untouched
    And a letter in quotes, or in backticks, is untouched
    And a letter glued into a longer name such as "C++" is untouched

  @unit
  Scenario: A bare slot letter is translated only where it cannot be an article
    Given the judge's explanation says "C is more complete than A"
    When I read the reasoning
    Then both letters name their variants
    And letters written as a list item or in parentheses name their variants too
    And a letter introduced by a comparison word such as "compared with" names its variant
    And a capitalized article in title case, such as "compared with A Concise Answer", is untouched

  # The two passes are shown the candidates in opposite orders, so slot A of
  # the second pass is a different variant from slot A of the first. Reading
  # one pass with the other's key would attribute the words to the wrong
  # variant, which is worse than leaving the letters in.
  @unit
  Scenario: Each judge pass is translated with the slot order it actually saw
    Given a row is checked twice, the second time with the candidate order reversed
    And the two passes pick different variants
    When I read why the row was inconclusive
    Then each pass's explanation names the variants that pass was shown
    And no words are attributed to the variant that held that slot in the other pass
