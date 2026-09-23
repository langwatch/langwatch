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

  # The run service and the refusal popover are the Instant Eval module's own; they arrive
  # with it. What is here is the search bar's half: the handover, how a chip is
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

    @integration
    Scenario: A registered run is sent with every read the Explorer makes
      Given a chip `eval:"the user is annoyed"` and a run registered under its key
      When the list, the facets and the new count are read
      Then each read carries evalRuns with the question, the target and the run id

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

  Rule: An eval chip filters by a run's verdicts

    @unit
    Scenario: An eval chip with a registered run compiles to a verdict subquery
      Given a query with an eval chip and the run registered for it
      When the filter is compiled
      Then it keeps the traces whose latest verdict for that run passed
      And the run and the window its judgements were written in are bound as parameters

    @unit
    Scenario: A conversation chip keeps every trace of a matched conversation
      Given a chip whose run judged conversations
      When the filter is compiled
      Then it compares the conversation id rather than the trace id

    @unit
    Scenario: A negated eval chip keeps the traces the judge did not match
      Given a query negating an eval chip with a registered run
      When the filter is compiled
      Then the verdict subquery is negated whole

    @unit
    Scenario: A target modifier only resolves a run of that target
      Given a chip forcing a unit and a run of another unit
      When the filter is compiled
      Then it matches no rows

    @unit
    Scenario: An eval chip with no registered run matches nothing
      Given a chip forcing a unit and no run registered for it
      When the filter is compiled
      Then it matches no rows, so the table is empty while the run starts

    @unit
    Scenario: A bare eval chip with no registered run keeps its older meaning
      Given a bare eval chip and no run registered for it
      When the filter is compiled
      Then it reads the value as an evaluator name, as it did before Instant Evals

    @unit
    Scenario: The run id rides in the URL fragment
      Given a fragment carrying `run=<key>:<runId>` twice
      When the fragment is parsed
      Then both runs are read back keyed by their key
      And building the fragment from that state writes the same two entries

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
    Scenario: Every explorer read checks the runs its chips claim
      Given a table, sessions, facets or new-count read naming a run for its chip
      When the read compiles its filter
      Then the claimed run is checked against the project and dated before the compiler binds it
      And a run the project does not own leaves its chip pending, selecting no rows

    @unit
    Scenario: The eval field cannot be evaluated in memory
      Given a trigger evaluating a saved query with a forcing eval chip
      When the field is evaluated against a trace in memory
      Then it answers unsupported, so the query fails closed

    @unit
    Scenario: The eval field is in the query reference and the autocomplete
      When the search field registry is read
      Then eval and its three target spellings are published under the eval group

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
