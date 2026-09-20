Feature: Instant Evals inside the Trace Explorer

  As someone searching traces
  I want a sentence that needs a judgement of each trace to become an eval chip in the search bar
  So that the traces the judge matched show in the same table, with the same counts, as any other filter

  The shape:
  - An Instant Eval run is one chip, `eval:"<question>"`. The chip's value is the question as
    the judge reads it. `eval:` judges what the lens shows (conversations on the Conversations
    lens, traces everywhere else); `eval.trace:`, `eval.conversation:` and `eval.llm:` force
    the unit judged, so a lens change cannot silently change what a saved chip means.
  - The run behind a chip is keyed to its scope: the question, the unit judged, the other chips
    of the query and the window. The client sends `evalRuns`, one entry per chip it holds a run
    for, with every list, facet and new-count read, and the URL fragment carries `run=<key>:<runId>`
    so a refresh or a shared link reuses the judgements instead of paying for them again.
  - The run starts under a cost rule: an estimate first, then a start when the estimate is under
    half a dollar, and a confirm dialog otherwise.
  - Progress is visible on the table, matches appear as pages finish, and every refusal is a
    closable popover that leaves a phrase search behind, never an error state.

  Background:
    Given a project with traces in the window
    And the Instant Evals flag is on for the project
    And a classifier is configured

  # ---------------------------------------------------------------------------
  # The chip
  # ---------------------------------------------------------------------------

  Rule: An eval chip filters by a run's verdicts

    @unit
    Scenario: An eval chip with a registered run compiles to a verdict subquery
      Given the query `eval:"the user is annoyed"`
      And an evalRuns entry whose question is "the user is annoyed", target "traces" and run "run-1"
      When the filter is compiled for ClickHouse
      Then the condition keeps traces whose latest verdict for run "run-1" passed
      And the subquery filters TenantId first, bounds the judgement's written time, and reads the latest version with argMax

    @unit
    Scenario: A conversation chip keeps every trace of a matched conversation
      Given the query `eval.conversation:"the user is annoyed"`
      And an evalRuns entry for that question with target "threads" and run "run-2"
      When the filter is compiled for ClickHouse
      Then the condition compares the trace's conversation id to the matched conversation ids of run "run-2"

    @unit
    Scenario: A target modifier only resolves a run of that target
      Given the query `eval.llm:"the answer is wrong"`
      And an evalRuns entry for that question with target "traces"
      When the filter is compiled for ClickHouse
      Then the condition matches no rows

    @unit
    Scenario: An eval chip with no registered run matches nothing
      Given the query `eval.trace:"the user is annoyed"`
      And no evalRuns entry
      When the filter is compiled for ClickHouse
      Then the condition matches no rows

    @unit
    Scenario: A bare eval chip with no registered run keeps its older meaning
      Given the query `eval:faithfulness`
      And no evalRuns entry
      When the filter is compiled for ClickHouse
      Then the condition is the evaluator-name lookup the field had before Instant Evals

    @unit
    Scenario: A negated eval chip keeps the traces the judge did not match
      Given the query `NOT eval:"the user is annoyed"`
      And an evalRuns entry for that question
      When the filter is compiled for ClickHouse
      Then the verdict subquery is negated

    @unit
    Scenario: The eval field cannot be evaluated in memory
      Given a trigger evaluating `eval.trace:"the user is annoyed"` against a trace in memory
      When the field is evaluated
      Then it answers unsupported, so the whole query fails closed

    @unit
    Scenario: The eval field is in the query reference and the autocomplete
      When the search field registry is read
      Then it lists eval, eval.trace, eval.conversation and eval.llm under the eval group

    @integration
    Scenario: A run's verdicts filter the table and the sidebar agrees
      Given a run "run-1" of the project with judgements on three traces, two of them passed
      And the run is registered in evalRuns for the chip `eval:"the user is annoyed"`
      When the list is read with that chip
      Then it returns the two passed traces
      And the facets read with the same chip counts the same two traces

    @integration
    Scenario: A run of another project is not a run of this one
      Given a run id that belongs to another project
      And the run is registered in evalRuns for an eval chip
      When the list is read with that chip
      Then it returns no traces

  # ---------------------------------------------------------------------------
  # The run key
  # ---------------------------------------------------------------------------

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
    Scenario: The run id rides in the URL fragment
      Given a fragment carrying `run=<key>:<runId>` twice
      When the fragment is parsed
      Then both runs are read back keyed by their key
      And building the fragment from that state writes the same two entries

    @integration
    Scenario: A registered run is sent with every read the Explorer makes
      Given a chip `eval:"the user is annoyed"` and a run registered under its key
      When the list, the facets and the new count are read
      Then each read carries evalRuns with the question, the target and the run id

    @integration
    Scenario: A chip with no registered run is pending
      Given a chip `eval:"the user is annoyed"` and no run under its key
      When the chips are resolved
      Then the chip is reported as pending and no evalRuns entry is sent for it

  # ---------------------------------------------------------------------------
  # Starting a run
  # ---------------------------------------------------------------------------

  Rule: A run starts under the cost rule

    @integration
    Scenario: An estimate under half a dollar starts the run
      Given the router handed over a question for "annoyed users"
      And the estimate is 0.20 USD
      When the Explorer receives the payload
      Then the run starts without a dialog
      And the query becomes the other chips plus `eval:"<question>"`
      And the run is registered under the chip's key

    @integration
    Scenario: An estimate of half a dollar or more asks first
      Given the router handed over a question
      And the estimate is 2.40 USD over 12,000 rows
      When the Explorer receives the payload
      Then a dialog shows the question as understood, the rows and the estimated cost
      And "Run" starts the run
      And "Search the words instead" applies the phrase search

    @integration
    Scenario: A target that differs from the lens default is written on the chip
      Given the Conversations lens judges conversations
      And the router handed over a question with target "traces"
      When the run starts
      Then the chip is `eval.trace:"<question>"`

    @integration
    Scenario: A run already registered for the scope is reused
      Given a run registered under the key the payload would compute
      When the Explorer receives the payload
      Then no estimate is made and the chip is applied

    @integration
    Scenario: The start binds the exact window
      Given the router handed over a question with a window
      When the run starts
      Then the start request carries the window's exact bounds, the other chips as the filter and one boolean question

    @unit
    Scenario: The bar names the step between Enter and the progress bar
      Given a sentence the router answered as an Instant Eval
      When the estimate is being made, and then the run is being started
      Then the search bar reads "Estimating the Instant Eval" and then "Starting the Instant Eval"
      And while the router decides it reads "Searching"

  Rule: tRPC wraps the run service for the Explorer

    @unit
    Scenario: The Explorer's request becomes the shorthand
      Given a target, the other chips as the filter, an exact window and a question
      When the request is turned into the run service's input
      Then it is a shorthand with the window as ISO instants and one boolean question
      And the run's counters are answered in the Explorer's own shape

  # ---------------------------------------------------------------------------
  # Progress
  # ---------------------------------------------------------------------------

  Rule: Progress is visible while a run judges

    @integration
    Scenario: A determinate bar reads the run's counters
      Given a run with total 10,000, progress 3,200 and 412 matched
      When the progress bar renders
      Then it reads "Judging 3,200 / 10,000 · 412 matched" with a Stop button
      And the bar is at 32 percent

    @integration
    Scenario: Matches appear as pages finish
      Given a run whose progress moves from 1,000 to 2,000
      When the poll reports the new progress
      Then the list and the facets are refetched

    @integration
    Scenario: The header count reads the run's counters during a run
      Given a run with total 10,000, progress 3,200 and 412 matched
      When the explorer counts are read
      Then the summary reads "412 matched so far · 3,200 of 10,000 judged"
      And after the run finishes the summary is the plain count

    @integration
    Scenario: Stop cancels the run and keeps the chip as partial
      Given a running run
      When Stop is pressed
      Then cancel is called with the run id
      And the chip stays, marked partial, with a tooltip naming judged versus total

  # ---------------------------------------------------------------------------
  # Refusals
  # ---------------------------------------------------------------------------

  Rule: A refusal is a popover, never an error state

    @integration
    Scenario: A spent free budget opens the budget popover and the phrase search runs
      Given the organization has spent its free Instant Evals budget
      When the Explorer receives an Instant Eval payload
      Then a closable popover anchored to the search bar says what an Instant Eval would have found
      And it shows the spend against the 1 USD budget with an Upgrade link
      And "Skip" and closing both apply the phrase search

    @integration
    Scenario: A missing classifier opens the model popover and the phrase search runs
      Given the deployment has no classifier
      When the Explorer receives an Instant Eval payload
      Then a closable popover says to configure a model
      And closing it applies the phrase search

    @integration
    Scenario: Any other refusal falls back to the phrase search
      Given the estimate fails for a reason the registry names
      When the Explorer receives an Instant Eval payload
      Then the phrase search is applied
      And the refusal's copy is shown from the presentation registry
