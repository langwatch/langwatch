Feature: Comparison from the SDK (code-first n-way judging)
  # Extends specs/experiments/comparison.feature to code-first experiments,
  # the ones a customer writes in a notebook or a CI script with
  # langwatch.experiment.init(), not the ones built in the workbench.
  #
  # The workbench executes its targets server-side, so its candidates are
  # platform objects (a prompt, an agent, a workflow). A code-first
  # experiment's candidates are the customer's own code, already run on
  # their machine. The SDK has always modelled those as targets; what was
  # missing is that nothing connected a set of targets to the judge.
  #
  # So there is no new judge and no new storage here. The same
  # langevals/select_best_compare decides the winner, and the verdict is
  # reported through the same batch protocol the SDK already speaks, which
  # is why the results page renders it without knowing where it came from.

  Background:
    Given a code-first experiment created with the SDK
    And a dataset row with an "input" field
    And targets "gpt-5-mini", "claude-sonnet-5" and "gemini-flash" have each
      recorded an output for that row

  # The point of the whole feature: judging N candidates should cost one
  # call and no configuration. Everything else here is a refinement of this.
  @unit
  Scenario: Comparing every target on a row takes one call
    When I compare the row
    Then the three recorded outputs are judged together in a single verdict
    And I did not have to name the candidates
    And I did not have to choose a judge prompt

  @unit
  Scenario: The verdict names the winning target
    Given the judge picked "claude-sonnet-5"
    When I compare the row
    Then the verdict's winner is "claude-sonnet-5"
    And the verdict carries the judge's reasoning
    And the winner is named with the target name I registered, not an internal id

  # Candidates come from the targets that actually produced something. A
  # target that errored or returned nothing has no output to judge, so it
  # is not a candidate, since including it would ask the judge to rank silence.
  @unit
  Scenario: Only targets with an output become candidates
    Given "gemini-flash" failed on this row and recorded no output
    When I compare the row
    Then the verdict is decided between "gpt-5-mini" and "claude-sonnet-5"
    And the verdict lists exactly those two as the candidates it saw

  # Mirrors "A row with a missing candidate output is skipped" in
  # comparison.feature. One unjudgeable row must not end the run: a loop
  # over a thousand rows would lose everything after the first bad one.
  @unit
  Scenario: A row with fewer than two outputs is skipped, not failed
    Given only "gpt-5-mini" recorded an output for this row
    When I compare the row
    Then no judge call is made
    And the verdict's status is skipped
    And the verdict explains that a comparison needs at least two outputs
    And the experiment keeps running

  # Asking for a specific target that isn't there is a mistake in the
  # caller's code, not a thin row. Silently comparing whatever remains
  # would hide it, and the customer would read a two-way verdict as the
  # three-way one they asked for.
  @unit
  Scenario: Naming a target that produced no output is an error
    Given "gemini-flash" recorded no output for this row
    When I compare the row naming "gpt-5-mini", "claude-sonnet-5" and "gemini-flash"
    Then the comparison fails with an error naming "gemini-flash"

  @unit
  Scenario: Comparing a subset of the registered targets
    When I compare the row naming only "gpt-5-mini" and "claude-sonnet-5"
    Then "gemini-flash" is not judged
    And the verdict is decided between the two I named

  # Golden answers stay opt-in, exactly as in the workbench. Guessing a
  # reference column would frame the judge as golden-aware when it isn't.
  @unit
  Scenario: Judging on merits is the default
    When I compare the row without giving a reference answer
    Then the judge compares the candidates on their own merits
    And no reference answer is sent

  # One knob, not two. Passing a reference answer and separately having to
  # declare that a reference answer exists is a footgun: forget the second
  # and the judge silently ignores the first.
  @unit
  Scenario: Giving a reference answer turns on golden judging
    When I compare the row giving a reference answer
    Then the judge compares each candidate against that reference answer

  @unit
  Scenario: The judge prompt can be customized
    When I compare the row with my own judge prompt
    Then my prompt is used verbatim
    And the shipped default is not substituted for it

  # The four shipped defaults live in the judge and adapt per row to what
  # the row actually has. The SDK must not carry its own copy of them,
  # because a copy is a thing that drifts, and a drifted copy silently
  # disables the adaptation.
  @unit
  Scenario: The SDK does not ship its own copy of the judge prompt
    When I compare the row without customizing the prompt
    Then the SDK sends no prompt at all
    And the judge applies the default that fits the row

  # Same reasoning for every other setting: an unset option is absent from
  # the request, so the judge's own default applies and there is exactly
  # one place where a default is written down.
  @unit
  Scenario: Unset options are not sent
    When I compare the row without setting tie handling or ordering
    Then those settings are absent from the request

  @unit
  Scenario: Options I do set are sent
    When I compare the row with ties disallowed
    Then the request disallows ties

  # Duration is measured by the SDK as each target runs. Cost is not: the
  # platform works a target's cost out from its traces after the run, so at
  # the moment a verdict is asked for there is nothing to show. Offering it
  # would have put an empty metric in front of the judge on every row.
  @unit
  Scenario: Duration is the only per-candidate metric on offer
    When I ask the judge to weigh how long each candidate took
    Then each candidate carries the time it took
    And no candidate carries a cost
    And a cost metric cannot be asked for

  # Position bias is real and the judge mitigates it by shuffling, seeded
  # per row. The SDK knows the row index already, so leaving the caller to
  # pass it would be asking them to remember something we know.
  @unit
  Scenario: Candidate order is seeded from the row automatically
    When I compare the same row twice
    Then the candidate order presented to the judge is identical both times
    And comparing a different row shuffles differently

  # Naming a row is not a new question: each SDK already answers it in log(),
  # and compare() answers it the same way rather than inventing a second
  # convention. TypeScript infers the row from the iteration it is called in,
  # so a comparison written beside the targets it judges names nothing.
  @unit
  Scenario: The row being iterated is the row compared
    Given a run over several rows, each with its own answer
    When I compare a row from inside the iteration that produced it
    Then the candidates judged are that row's own outputs, on every row
    And I did not have to repeat the row index

  @unit
  Scenario: A row named explicitly is the row compared
    When I compare while naming a row other than the one being iterated
    Then the row I named is the one judged

  # There is no row to fall back to. Judging the first row because none was
  # named would answer a question about candidates the caller never asked
  # about, and it would come back looking like a real verdict.
  @unit
  Scenario: Comparing outside an iteration asks which row
    Given targets that ran outside any iteration
    When I compare without naming a row
    Then the comparison fails asking me to name the row
    And no judge call is made

  @unit
  Scenario: The judge may return a tie
    Given the judge found no candidate clearly better
    When I compare the row
    Then the verdict's status is tie
    And the verdict has no winner

  # Swap-and-reconcile judges each row twice with the order reversed and
  # reports nothing when the two disagree. That is not a tie: a tie is a
  # measurement, and this is the absence of one, so it must not read as one.
  @unit
  Scenario: A verdict that flips under order swap is inconclusive
    Given the judge reached different conclusions on the two passes
    When I compare the row
    Then the verdict's status is inconclusive
    And the verdict has no winner
    And it is not recorded as a tie

  # A comparison grades no single target, so it hangs off the row rather
  # than off any one of the candidates. Attaching it to a candidate would
  # make that candidate look independently graded.
  @unit
  Scenario: The verdict belongs to the row, not to a target
    When I compare the row
    Then the verdict is recorded against the row
    And it is not recorded against any single target

  @integration
  Scenario: The verdict reaches the results page
    Given I have compared every row of the experiment
    When I open the experiment's results page
    Then each row shows its winner and the judge's reasoning
    And the win rate per target is charted, including ties
    And a target that never won is still shown, with zero wins

  # Comparison is one feature, so it reads the same in both languages,
  # allowing for each one's spelling conventions and for how each already
  # names a row in log(): Python is handed the index by loop() and passes it
  # on, TypeScript infers it from the iteration.
  @unit
  Scenario: Both SDKs expose the same comparison
    Then the Python and TypeScript SDKs accept the same options
    And each names the row the way its own log() does
    And they return the same verdict shape
    And a comparison written in either language reports identically

  # The async path exists so a comparison inside an async loop does not
  # block the event loop while the judge is thinking.
  @unit
  Scenario: Comparing from an async experiment
    Given an experiment driven by the async loop
    When I await a comparison for a row
    Then the verdict is produced without blocking the loop
    And it is recorded exactly as the synchronous one is
