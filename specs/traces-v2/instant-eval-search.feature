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

    # A lens brings its own filter back, and a fragment naming only a lens
    # carries no query and therefore no run keys. Dropping the runs there left
    # an identical query offering "Judge these results", and taking it would
    # have started a second run over rows the first one had already judged.
    @integration
    Scenario: A lens round trip keeps the run behind a restored chip
      Given a lens whose filter carries an eval chip and a run held for its key
      When the fragment names only that lens
      Then the restored chip keeps its run, because the question, the target, the other chips and the window all still match its key
      And a run held under any other key is not carried, so a changed scope is judged again

    @unit
    Scenario: A registered run resets the new-count baseline
      Given the new count has settled for a query whose chip had no run
      When a run registers behind that chip
      Then the baseline is dropped, because the run changed what is counted
      And the next count is a baseline rather than a transition to compare against

    @unit
    Scenario: An empty table under an unjudged chip says these results are not judged
      Given a chip with no run for this window, lens and filter
      When the table has no rows
      Then the empty state says no Instant Eval has judged this question over this window, lens and filter
      And it does not claim a previous run covered something else, because a chip can arrive with no run at all
      And "Judge these results" submits the question through the search bar, with the other chips kept

    @unit
    Scenario: An eval chip is green, whatever its target
      Given the search bar holds `eval:"the user is annoyed"`, `eval.trace:"a"`, `eval.conversation:"b"` and `eval.llm:"c"`
      When the chips are drawn
      Then each is drawn as an eval chip, apart from the blue filter chips

    @integration
    Scenario: An eval chip sweeps while its run is under way
      Given an eval chip in the search bar
      When its run is being estimated, started, queued, planned or judged
      Then a band of light sweeps across the chip from left to right
      And once the run has finished, stopped or failed the chip rests

    @integration
    Scenario: A chip with no registered run is pending
      Given a chip `eval:"the user is annoyed"` and no run under its key
      When the chips are resolved
      Then the chip is reported as pending and no evalRuns entry is sent for it

    @integration
    Scenario: A chip typed by hand starts its run on Enter
      Given the reader types `status:error AND eval:"the user is annoyed"` and no run has answered that chip
      When Enter is pressed
      Then the chip is applied so the reader sees what they typed
      And the run is estimated and started on the question as written, with the other terms as its filter
      And no model rewrites the question on the way, since the reader wrote it
      And a chip spelled `eval.conversation:` keeps judging conversations, whatever the lens shows
      And the same question under another target is another chip, kept in the filter of the run that starts
      And a chip a run already answered is applied with no call at all
      And a refusal leaves the typed chip where it is rather than replacing it with a phrase search
      And "Judge these results" under an empty table starts the same run the same way

    @unit
    Scenario: A space belongs to the question being typed
      Given the reader has typed `eval:annoyed` with no quotes
      When they press space
      Then the value is quoted and the caret stays inside the quotes, so the next words join the question
      And picking `eval` from the field list opens the quotes for them in the same way
      And a space inside a value already quoted is typed as a space
      And a space after an ordinary field's value still ends the term
      And while the caret is inside the quotes no field list opens on a word of the question
      And Arrow Right, End or a click leaves the quotes, Enter searches from inside them, and a quote typed against the closing quote steps over it rather than opening a second pair

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
      And the criteria are shown as the classifier wrote them, one under Yes and one under No

    @integration
    Scenario: A target that differs from the lens default is written on the chip
      Given the Conversations lens judges conversations
      And the router handed over a question with target "traces"
      When the run starts
      Then the chip is `eval.trace:"<question>"`

    @integration
    Scenario: A second question judges the same rows as the first
      Given the bar already carries an eval chip
      When a second question starts a run
      Then the run judges the query without either eval chip
      And both chips stay in the bar, so a row must pass both
      And a request that still carries one has it dropped before the run is written, because no run reference comes with it

    @integration
    Scenario: A run already registered for the scope is reused
      Given a run registered under the key the payload would compute
      When the Explorer receives the payload
      Then no estimate is made and the chip is applied

    @integration
    Scenario: A new search supersedes a pending Instant Eval
      Given an estimate for one sentence is still in flight
      When the reader submits anything else, a filter, a phrase or a question for the assistant
      Then the pending estimate is abandoned before the new search runs
      And it cannot come back, start a run and put its chip over what is now on screen
      And the dialog and the refusal popover close with it

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
      And the run's total is a count of rows the table can show
      And a request whose chips name an origin is left as asked

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

    @unit
    Scenario: An empty table during a run says matches are still coming
      Given a run is judging and no row has matched yet
      When the table has no rows to show
      Then it says there are no matches yet and that the run is still judging
      And it does not say that nothing matches the filters
      And it does not offer "Clear filters" as the way out

    @integration
    Scenario: Matches appear as pages finish
      Given a run whose progress moves from 1,000 to 2,000
      When the poll reports the new progress
      Then the list and the facets are refetched
      And while the run judges the list is read again at most every 2 seconds and the facets at most every 8
      And a read still in flight is left to finish instead of being started again
      And when the run ends both are read once more, so the settled numbers are final

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
      And the partial chip shows the question in quotes, as the running chip does

    @integration
    Scenario: A stopped run is read until its numbers hold still
      Given a running run that was asked to stop
      Then the bar stays and says it is stopping, with Stop disabled
      When the run's status turns cancelled
      Then the run is still polled, because the page it held lands its verdicts last
      And the header, the pagination and the sidebar keep reading the run's counters
      When a second read answers the same counters
      Then the list and the facets are read one last time
      And only after they answer do the bar leave, the chip read partial and the counts read the list's total

    @unit
    Scenario: A run that ended long before the page opened is settled at once
      Given a run that finished more than fifteen seconds ago
      When the page reads it for the first time
      Then it is settled without a second read, and no bar is shown

  # ---------------------------------------------------------------------------
  # Refusals
  # ---------------------------------------------------------------------------

  Rule: A refusal is a popover, never an error state

    @integration
    Scenario: A spent free budget opens the budget popover and the phrase search runs
      Given the organization has spent its free Instant Evals budget
      When the Explorer receives an Instant Eval payload
      Then a closable popover anchored under the search bar says what an Instant Eval does, in two sentences
      And the text the user typed stays visible above it
      And it offers an Upgrade link, without the spend or budget figures
      And "Skip" and closing both apply the phrase search

    @integration
    Scenario: A missing classifier opens the model popover and the phrase search runs
      Given the deployment has no classifier, or the server refuses the run as not enabled for a released project
      When the Explorer receives an Instant Eval payload
      Then a closable popover says to configure a model
      And closing it applies the phrase search

    @integration
    Scenario: Instant Evals switched off open the contact-us popover and nothing is searched
      Given the Instant Evals flag is off for the project
      When the reader submits an eval chip
      Then a closable popover anchored under the search bar says Instant Evals aren't enabled for this project and offers to contact us
      And no estimate is requested and the typed query stays in the bar
      And closing it, by Escape or a click outside, keeps the typed query and searches nothing

    @integration
    Scenario: Any other refusal falls back to the phrase search
      Given the estimate fails for a reason the registry names
      When the Explorer receives an Instant Eval payload
      Then the phrase search is applied
      And the refusal's copy is shown from the presentation registry
