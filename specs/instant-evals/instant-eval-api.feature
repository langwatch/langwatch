Feature: The Instant Eval run over REST, one LWQL statement, judged as a job

  As an AI engineer or an agent driving the API
  I want to run an eval statement over my whole production history as a job
  So that a question I thought of today is answered across rows a synchronous query cannot reach

  Issue: Instant Evals, PR 4. ADR-137.

  The shape:
  - The input is always a LangWatchQL statement, the same one `POST /api/v1/query` runs. It
    must project `TraceId` and at least one eval function column.
  - `POST /api/v1/instant-evals` accepts and answers 202 with a queued run; the work happens
    on the queue and progress is polled.
  - The default row cap is 10,000 for every plan, and a paid plan may ask for up to 100,000.
  - Results live in ClickHouse and are read back page by page with a keyset cursor. The
    sample door re-reads the text that was judged, without judging anything again.

  Background:
    Given a project whose key carries analytics:view and analytics:manage
    And the Instant Evals flag is on for that project

  # ---------------------------------------------------------------------------
  # Creating a run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A statement that projects a trace id and a judged column is accepted
    Given a statement projecting TraceId and one eval column
    When it is submitted to the run endpoint
    Then the response is 202
    And the run is queued with its questions derived from the statement
    And the run carries the statement back verbatim

  @integration
  Scenario: A statement the query policy refuses is refused here with the same reason
    Given a statement naming a table the policy does not allow
    When it is submitted to the run endpoint
    Then the response is 422 with code instant_eval_query_invalid
    And the refusal names the policy violations

  @integration
  Scenario: A statement with no trace id is refused before anything runs
    Given a statement projecting only a judged column
    When it is submitted to the run endpoint
    Then the response is 422 with code instant_eval_query_missing_columns
    And the refusal names TraceId as the missing column

  @integration
  Scenario: A statement with no eval function is refused
    Given a statement projecting TraceId and no judged column
    When it is submitted to the run endpoint
    Then the response is 422 with code instant_eval_query_missing_columns
    And the refusal says at least one eval function is required

  @unit
  Scenario: The missing-column check runs the statement for no rows at all
    Given a statement whose columns are being checked
    When the check runs
    Then the statement is probed with a zero row limit
    And no judgement is made during the probe

  @unit
  Scenario: A statement declaring the surface-owned parameters is refused
    Given a statement declaring the dashboard period parameters
    When it is submitted to the run endpoint
    Then it is refused as an invalid query
    And the refusal names the parameters a job cannot fill

  @unit
  Scenario: A request supplying a reserved run parameter is refused
    Given a request whose parameters name the run's own page parameter
    When it is submitted to the run endpoint
    Then it is refused as an invalid query

  # ---------------------------------------------------------------------------
  # Caps
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A run with no requested limit takes the default cap
    Given a request with no limit
    When the run is created
    Then its limit is ten thousand rows

  @integration
  Scenario: A free plan asking past the default cap is refused and told what lifts it
    Given a project on a plan without the raised cap
    When a run is requested for fifty thousand rows
    Then the response is 422 with code instant_eval_row_cap_exceeded
    And the refusal carries the cap and the plan

  @integration
  Scenario: A paid plan may ask up to the raised cap
    Given a project on a plan with the raised cap
    When a run is requested for fifty thousand rows
    Then the run is accepted with that limit

  @unit
  Scenario: A limit past the raised cap is refused on every plan
    Given a request for two hundred thousand rows
    When the run is created
    Then it is refused as past the cap

  # ---------------------------------------------------------------------------
  # Estimating
  # ---------------------------------------------------------------------------

  @integration
  Scenario: An estimate counts the rows and prices them without judging any
    Given a statement matching four hundred rows
    When an estimate is requested
    Then it reports the rows, the average tokens, the total tokens and the requests
    And it reports our cost and the customer price
    And no judgement was made

  @unit
  Scenario: An estimate over more rows than the cap reports the cap it was bounded to
    Given a statement matching more rows than the run's limit
    When an estimate is requested
    Then the row count is the limit and the estimate says it was capped

  @unit
  Scenario: The average token count comes from a sample rather than from every row
    Given a statement matching ten thousand rows
    When an estimate is requested
    Then at most fifty rows had their text measured

  @unit
  Scenario: The sampled rows are spread across the selection, not taken from its start
    Given a statement matching ten thousand rows
    When an estimate is requested
    Then the sampled rows are drawn from across the whole selection
    And the sample is not the first rows the statement returns

  @unit
  Scenario: The page size is measured from the same spread of rows
    Given a statement matching ten thousand rows
    When the run is planned
    Then the page size comes from rows drawn across the whole selection

  @unit
  Scenario: A selection smaller than the sample has every row sampled
    Given a statement matching ten rows
    When an estimate is requested
    Then every matched row had its text measured

  @unit
  Scenario: A selection only just larger than the sample is still spread
    Given a statement matching seventy five rows
    When an estimate is requested
    Then the sample is drawn from at least two buckets
    And it is not the first fifty rows the statement returns

  @unit
  Scenario: A sample over spans is spread over spans, not over whole traces
    Given a statement whose rows are the spans of each trace
    When the sample statement is composed
    Then the bucket is chosen from the trace and span pair together
    And the spans of one trace do not all land in one bucket

  @unit
  Scenario: Half of the list's cursor is refused, naming the missing half
    Given a list request carrying before without beforeId, or the reverse
    When the request is validated
    Then it is refused
    And the refusal names the half that is missing

  @unit
  Scenario: Judged text is priced at the classifier's own published byte ratio
    Given a judged text of known length
    When its input tokens are estimated
    Then the count uses the ratio the classifier publishes rather than a prose rule

  # ---------------------------------------------------------------------------
  # Reading a run
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A run reports its progress, its matches per question and what it spent
    Given a run that judged two pages
    When it is read
    Then it carries the total, the progress, the matched count per question, the failures and the skips
    And it carries the tokens, our cost and the customer price

  @integration
  Scenario: Runs are listed newest first and scoped to the credential's project
    Given two runs in this project and one in another
    When the runs are listed
    Then only this project's runs are listed, newest first

  @integration
  Scenario: A run of another project is not found
    Given a run belonging to another project
    When it is read with this project's key
    Then the response is 404 with code instant_eval_not_found

  # ---------------------------------------------------------------------------
  # Results and samples
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Results are read page by page with a cursor that never repeats a row
    Given a run with more judgements than one page carries
    When the results are read twice with the returned cursor
    Then no judgement appears in both pages
    And the last page carries no cursor

  @integration
  Scenario: Results can be narrowed to one question and to the matches only
    Given a run with two questions
    When the results are read for one question and matches only
    Then every judgement belongs to that question and passed

  @integration
  Scenario: A sample re-reads the text that was judged without judging it again
    Given a finished run
    When a sample of five rows is requested
    Then each row carries the text that was judged and the verdict it received
    And no judgement was made

  @unit
  Scenario: A sample is bounded to twenty five rows
    Given a sample requested for a hundred rows
    When the request is validated
    Then it is refused as past the sample ceiling

  # ---------------------------------------------------------------------------
  # Cancelling
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A running run can be cancelled
    Given a run in progress
    When it is cancelled
    Then the response says cancellation was requested
    And the run stops before the next page

  @integration
  Scenario: A finished run cannot be cancelled
    Given a finished run
    When it is cancelled
    Then the response is 409 with code instant_eval_already_finished

  # ---------------------------------------------------------------------------
  # Access
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A project without the flag cannot reach the family
    Given a project whose Instant Evals flag is off
    When a run is requested
    Then the response is 403 with code instant_eval_not_enabled

  @integration
  Scenario: A read-only key cannot create or cancel a run
    Given a key carrying analytics:view only
    When a run is requested
    Then the response is 403
    And listing runs with the same key succeeds
