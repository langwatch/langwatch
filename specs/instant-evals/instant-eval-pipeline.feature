Feature: The Instant Eval run on the queue, plan, judge page by page, finish

  As the platform
  I want a judged statement to run as a job with progress, cancellation and safe redelivery
  So that a hundred thousand rows can be judged without a caller holding a request open

  Issue: Instant Evals, PR 4. ADR-137.

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
  Scenario: Pass one selects the keys and nothing else
    Given a statement projecting a judged column
    When the key pass is composed
    Then it selects the trace id, the thread id and the occurrence time from the statement
    And the statement inside it is the caller's own text, unchanged

  @unit
  Scenario: Pass one runs with the row cap raised by one so a capped run can say so
    Given a run limited to ten thousand rows
    When the key pass runs
    Then its row ceiling is ten thousand and one

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

  @unit
  Scenario: A matched judgement is one that passed, scored or landed on a label
    Given a page holding a passing boolean, a score and a category
    When the matches are counted
    Then the boolean counts as matched only when it passed
    And the score and the category count as judged rather than matched

  # ---------------------------------------------------------------------------
  # Cancellation, stalls and redelivery
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A cancelled run stops between pages
    Given a run in progress
    When cancellation is requested
    Then the next page is not judged
    And the run finishes as cancelled with the progress it reached

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

  @integration
  Scenario: A finished run records what it cost in one row
    Given a run that judged a thousand texts
    When it finishes
    Then exactly one cost row is written for the run
    And it carries our cost, the customer price and the tokens
