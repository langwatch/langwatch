Feature: The Instant Eval run on the queue, plan, judge page by page, finish

  As the platform
  I want a judged statement to run as a job with progress, cancellation and safe redelivery
  So that a hundred thousand rows can be judged without a caller holding a request open

  Issue: Instant Evals, PR 4. ADR-153.

  The shape:
  - Pass one collects the keys only, so the run knows its total before it spends anything.
  - Pass two runs the same statement per page, bound to that page's trace ids, which is
    where the extraction and eval functions hydrate under the key cap.
  - Events carry ids and numbers only. A hundred thousand rows with three questions is a
    couple of hundred events, not three hundred thousand.
  - Redelivery is safe because a page is idempotent by its own key and the judgements land
    in a replacing table.

  Background:
    Given a project with the Instant Evals flag on
    And a classifier that answers every question

  # ---------------------------------------------------------------------------
  # The topology
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A requested run is planned, judged page by page, and finished
    Given a statement matching twelve hundred rows and a page size of five hundred
    When the run is requested
    Then the run is planned with a total of twelve hundred
    And three pages are judged in order
    And the run finishes with its progress equal to its total

  @unit
  Scenario: The worker mounts one run projection, five commands and the process manager
    Given the Instant Eval pipeline
    When the worker builds it
    Then the run's counters are projected on a row keyed by the run
    And the five commands and the run's process manager are mounted
    And no map projection or subscriber is mounted, because a page writes its own rows

  @unit
  Scenario: Every event of a run is keyed by the run, so its pages fold in order
    Given two runs of one project judging at the same time
    When their events are appended
    Then each event carries its own run as the aggregate
    And the project has one queue lane, so a run's pages never overtake each other

  @unit
  Scenario: A page recorded twice carries one event key, and the next page its own
    Given a page that has already been recorded
    When the same page is recorded again
    Then it carries the event key of the first, so the second append collapses
    And the queue dedups the redelivery inside the page's own window
    And the next page carries a key of its own, so it is counted separately

  @unit
  Scenario: A finish delivered twice is one finish
    Given a run that has already finished
    When the finish is delivered again
    Then it carries the same event key as the first

  @unit
  Scenario: A page that arrives after a later one does not rewind the run
    Given a run that has counted its third page
    When its second page arrives
    Then the run's cursor and counters are unchanged and nothing is asked for

  @unit
  Scenario: A page never exceeds the key cap of the statement's own functions
    Given a run whose statement extracts conversations, whose keys cap lower than a page
    When the run is planned
    Then the page is cut to that cap, rather than failing the run on it

  @unit
  Scenario: A statement over traces keeps the full page
    Given a run whose statement extracts traces
    When the run is planned
    Then the page stays at the default size

  @unit
  Scenario: A large-text page stays small even when the cap is higher
    Given a run whose texts are large and whose key cap is not the binding one
    When the run is planned
    Then the smaller of the two bounds is the page size

  @unit
  Scenario: Pass one selects the keys and nothing else
    Given a statement projecting a judged column
    When the key pass is composed
    Then it selects the trace id, the thread id and the occurrence time from the statement
    And the statement inside it is the caller's own text, unchanged

  @unit
  Scenario: The run's total comes from a count rather than from every key
    Given a run limited to ten thousand rows
    When the run is planned
    Then the count runs bounded one row past the limit
    And the reported total is the limit when the selection is larger

  @unit
  Scenario: A read that came back truncated fails the step
    Given a read the executor cut short at its byte ceiling
    When the count or the key pass reads it
    Then the step fails rather than reporting a smaller answer

  @unit
  Scenario: Pass one makes no judgement
    Given a statement projecting a judged column
    When the key pass runs
    Then the classifier is never called

  @unit
  Scenario: A page binds its own trace ids into the statement
    Given a page of five hundred trace ids
    When the page pass is composed
    Then the statement is wrapped so only those trace ids are returned
    And the caller's own text is unchanged inside it

  @unit
  Scenario: A page of large texts is smaller than a page of small ones
    Given a statement whose sampled texts average more than twelve kilobytes
    When the page size is chosen
    Then it is a hundred rows rather than five hundred

  @unit
  Scenario: A page never exceeds the key cap of the statement's own functions
    Given a run whose statement extracts conversations, whose keys cap lower than a page
    When the run is planned
    Then the page is cut to that cap, rather than failing the run on it

  @unit
  Scenario: A statement over traces keeps the full page
    Given a run whose statement extracts traces
    When the run is planned
    Then the page stays at the default size

  @unit
  Scenario: A large-text page stays small even when the cap is higher
    Given a run whose texts are large and whose key cap is not the binding one
    When the run is planned
    Then the smaller of the two bounds is the page size

  @unit
  Scenario: The next page is read while the current one is judged
    Given a run whose classifier is busy with a page
    When that page is being judged
    Then the next page's keys, rows and texts are read before the judging resolves
    And the intent that asks for the next page is handed what was read, so it is read once
    And one page is judged at a time
    And an intent asking for a different page, a cancellation or a failed page drops what was read ahead

  # ---------------------------------------------------------------------------
  # Progress
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A judged page reports ids and counts, never text
    Given a page of judged rows
    When the page event is built
    Then it carries trace ids, question ids and numbers
    And it carries no judged text

  @unit
  Scenario: The run row is folded from the page events
    Given a run that has judged two pages
    When the fold runs
    Then the run row holds the progress, the matches per question, the failures, the skips and the tokens
    And the row lives in ClickHouse beside the judgements, keyed by the tenant and the run
    And the fold lays the counters over the definition the service wrote without rewriting it

  @unit
  Scenario: A statement with one row per span pages by the trace and the span
    Given a statement that projects a span id
    When a page is composed
    Then the key pass orders by the trace and the span together
    And a later page's cursor carries both halves
    And a statement projecting no span id pages by the trace alone

  @unit
  Scenario: A statement with one row per span writes one judgement per span
    Given a page holding two spans of one trace
    When it is mapped
    Then each span is its own judgement rather than one overwriting the other

  @unit
  Scenario: A page drops the rows of a trace it shares with the next page
    Given a page read that brought back a neighbour's span rows
    When the page's rows are taken
    Then only the pairs the page owns are kept
    And no row the page does not own is judged

  @integration
  Scenario: A run over several rows per trace judges every row
    Given a statement with two rows per trace
    When the run is driven to its end
    Then every row is judged and none is skipped by the page boundary

  @unit
  Scenario: A matched judgement is one that passed, scored or landed on a label
    Given a page holding a passing boolean, a score and a category
    When the matches are counted
    Then the boolean counts as matched only when it passed
    And the score and the category count as judged rather than matched
    And the run's own matched total counts the boolean questions only
    And it is absent for a run that asked no boolean question

  # ---------------------------------------------------------------------------
  # Cancellation, stalls and redelivery
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A cancelled run stops between pages
    Given a run in progress
    When cancellation is requested
    Then the next page is not judged
    And the run finishes as cancelled with the progress it reached

  @unit
  Scenario: A page stopped part way keeps the judgements it made
    Given a page whose judging is stopped after some rows answered
    When the page is written
    Then the rows that answered are written with their verdicts
    And a row the stop reached before its answer is written as skipped, naming the stop
    And the rows after the last judged one are not written
    And the page's tokens are the tokens of the rows that answered
    # A stop used to throw the whole page away, verdicts and usage together,
    # so a caller could start and cancel first pages without the free
    # allowance ever seeing what was judged.

  @unit
  Scenario: A page judges under a deadline inside its lease
    Given a page intent leased for ten minutes
    When the page is judged
    Then the judging stops before the lease lapses, with a margin to write what was judged
    And the page reports the last judged key as its cursor and that more is left
    And the next intent asks for the rows after that key
    # Past the lease another dispatcher may lease the same intent and judge
    # the page again, paying for it twice.

  @unit
  Scenario: A page with no lease left is not started
    Given a page intent whose lease has less than the margin left
    When the page is judged
    Then nothing is read or judged
    And the intent fails so the outbox delivers it again under a fresh lease

  @unit
  Scenario: A page cancelled part way ends the run where it got to
    Given a page whose judging is stopped by a cancellation
    When the page is written
    Then the rows that answered are written
    And the page reports no next page, because the run is finishing

  @integration
  Scenario: A run whose pages stop arriving is failed by the watchdog
    Given a run whose last page landed more than fifteen minutes ago
    When the watchdog runs
    Then the run is failed with the stalled reason

  @integration
  Scenario: A redelivered page writes the same judgements rather than doubling them
    Given a page that has already been judged
    When the same page is delivered again
    Then the run's progress is unchanged
    And the judgements table holds one row per trace and question

  @unit
  Scenario: A page that mostly failed is thrown so the queue delivers it again
    Given a page where more than half the rows could not be judged
    When the page is judged
    Then it throws rather than recording a mostly empty page

  @unit
  Scenario: A page that partly failed is recorded with its failures counted
    Given a page where a tenth of the rows could not be judged
    When the page is judged
    Then the page is recorded and the failures are counted

  # ---------------------------------------------------------------------------
  # What is written
  # ---------------------------------------------------------------------------

  @integration
  Scenario: One judgement row is written per trace and question
    Given a run with two questions over three traces
    When the run finishes
    Then six judgement rows are written
    And each row carries the run, the trace, the question and its verdict

  @integration
  Scenario: No judged text is stored
    Given a finished run
    When the judgements are read
    Then no column holds the text that was judged

  @unit
  Scenario: A finished run reports its spend once
    Given a run that judged a thousand texts
    When it finishes
    Then exactly one spend record is reported for the run
    And it carries our cost, the customer price and the tokens

  # ---------------------------------------------------------------------------
  # What a page sends to the classifier, and what comes back into its rows
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every question about one text is one classifier request
    Given a page row whose questions are all about the same text
    When the page's requests are built
    Then there is one request carrying every question
    And rows are never packed together into one request

  @unit
  Scenario: Questions about different texts are separate requests
    Given a page row with one question about the conversation and one about the last answer
    When the page's requests are built
    Then there is one request per text

  @unit
  Scenario: A row whose extraction found no text is not sent
    Given a page holding a row with an empty text and a row with a conversation
    When the page's requests are built
    Then only the row with a conversation has a request

  @unit
  Scenario: A page whose questions leave no room for text is refused before anything is sent
    Given questions that alone fill the classifier's state
    When the page's requests are built
    Then the run fails with instant_eval_questions_too_long
    And nothing is sent to the classifier

  @unit
  Scenario: A page that would send more text than its rows could carry is refused before anything is sent
    Given a page whose texts together exceed the token budget its rows allow
    When the page is checked against its ceiling
    Then the run fails with instant_eval_query_budget_exceeded naming the estimated tokens and the budget
    And nothing is sent to the classifier

  @unit
  Scenario: Each verdict lands in its own column and unanswered rows are named
    Given a page where one row was answered, one was not reached and one had no text
    When the rows are written
    Then the answered row holds its verdict in the question's column
    And the row that was not reached is named as unjudged
    And the row with no text is null without being named as unjudged

  @unit
  Scenario: A question the classifier declined is null and does not make its row unjudged
    Given a page row whose only question the classifier declined
    When the rows are written
    Then the cell is null
    And no row is named as unjudged

  # Every pass re-validates the caller's statement with the full policy, then
  # runs it inside a wrapper Analytics composes from the pass's kind (probe,
  # count, keys, sample, page). A caller names a kind and never sends wrapper SQL.
  @unit
  Scenario: A statement calling eval at the top level runs its passes
    Given a statement that calls eval in its top-level projection
    And the project may call eval functions
    When each pass kind runs it
    Then the statement is re-validated and accepted
    And the pass reaches the database inside its wrapper as the caller's restricted identity

  @unit
  Scenario: A pass re-validates its statement with the full policy
    Given a statement the query policy refuses
    When a pass is asked to run it
    Then the pass is refused with the policy's own code
    And nothing reaches the database

  @unit
  Scenario: A pass cannot carry SQL of its own
    Given a pass naming wrapper SQL, an unknown kind or an unlisted key column
    When it is asked to run
    Then it is refused before anything reaches the database
