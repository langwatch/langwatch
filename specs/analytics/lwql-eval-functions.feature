Feature: LangWatchQL eval functions — a judged column, computed by the classifier after the query

  As an agent or an engineer writing LangWatchQL
  I want to ask a question of every conversation a statement selects and get a calibrated answer per row
  So that I can search production history by meaning instead of by keyword, in one statement

  Issue: Instant Evals, PR 2b. ADR-136 (amended).

  What this adds to the extraction functions of PR 2:
  - `eval`, `eval_passed`, `eval_score`, `eval_category` and `eval_category_probs` are app
    functions like the extraction ones: a projection UDF in ClickHouse, projection-only,
    alias required, value computed by the application after the query runs.
  - Their key is the text to judge. It is normally another app function, so an eval
    function may nest an extraction function one level deep — the only nesting the
    validator allows anywhere. Hydration then runs extraction first and the eval second.
  - Several eval calls over the same nested expression are one classifier request per row,
    carrying every question. Rows are never packed together: the bench measured 98%
    agreement on single conversations against 87% with eight packed into one request.

  Background:
    Given a project whose credential holds analytics:view
    And the caller holds the captured-input and captured-output permissions
    And the Instant Evals flag is on for the project
    And a classifier is configured for the deployment

  # ---------------------------------------------------------------------------
  # The golden path
  # ---------------------------------------------------------------------------

  @unit
  Scenario: One question over an extracted conversation is accepted and planned
    Given a statement selecting eval(conversation(ConversationId), 'The customer sounds annoyed') AS annoyed
    When the statement is validated
    Then it is accepted
    And the hydration plan names the column "annoyed", the function "eval" and the nested function "conversation"

  @unit
  Scenario: The judged column carries the probability, not the conversation key
    Given a conversation the classifier answers with a probability of 0.9
    When a statement projecting eval(conversation(ConversationId), 'The customer sounds annoyed') AS annoyed is hydrated
    Then the column holds 0.9
    And the column type is reported as Nullable(Float64)

  @unit
  Scenario: Three questions over one text cost one classifier request per row
    Given a statement projecting eval, eval_score and eval_category over the same conversation expression
    When the statement is hydrated over one row
    Then the classifier received exactly one request
    And that request carried three questions
    And each column holds the answer to its own question

  @unit
  Scenario: Two different texts in one statement are two requests per row
    Given a statement projecting an eval over the conversation and an eval over the trace digest
    When the statement is hydrated over one row
    Then the classifier received two requests

  @unit
  Scenario: An eval over a plain column needs no extraction read
    Given a statement selecting eval(CapturedOutput, 'The answer is an apology') AS apology
    When the statement is hydrated
    Then the classifier was asked about the column's own text
    And no trace was read

  @unit
  Scenario: Each eval function reports the answer its kind names
    Given a classifier answering a probability of 0.8, a level distribution and a category distribution
    When the four eval functions are hydrated
    Then eval holds the probability
    And eval_passed holds 1 when the probability is at or above its threshold and 0 below it
    And eval_score holds the probability-weighted mean inside the declared range
    And eval_category holds the most likely option name
    And eval_category_probs holds a JSON object of option name to probability

  # ---------------------------------------------------------------------------
  # Nesting: one level, extraction only
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An eval nested inside an eval is refused
    Given a statement selecting eval(eval(conversation(ConversationId), 'a'), 'b') AS nested
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION

  @unit
  Scenario: An extraction function nested two levels deep is refused
    Given a statement nesting an extraction function inside another extraction function inside an eval
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION

  @unit
  Scenario: An extraction function still may not nest an eval function
    Given a statement selecting conversation(eval(CapturedOutput, 'a')) AS transcript
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION

  @unit
  Scenario: An eval in WHERE is refused rather than silently comparing the text
    Given a statement filtering on eval(CapturedOutput, 'anything') > 0.5
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION

  # ---------------------------------------------------------------------------
  # Arguments
  # ---------------------------------------------------------------------------

  @unit
  Scenario: eval takes two arguments, and the criteria form is its own function
    Given a statement calling eval with a criteria argument
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT
    And the message names eval_criteria as the function that takes one

  @unit
  Scenario: The criteria argument is two strings, what counts as yes and what does not
    Given a statement calling eval with a criteria array holding one string
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

  @unit
  Scenario: A category needs between two and 255 options
    Given a statement calling eval_category with a single option
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

  @unit
  Scenario: A category option is written as name and description
    Given a statement calling eval_category with an option that has no description
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

  @unit
  Scenario: A score range must run upwards
    Given a statement calling eval_score with a minimum above its maximum
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

  @unit
  Scenario: A score range holds at most ten levels
    Given a statement calling eval_score with a range of zero to ten
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT
    And the message names the ten-level ceiling the judge holds

  @unit
  Scenario: A threshold outside zero to one is refused
    Given a statement calling eval_passed with a threshold of 2
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

  @unit
  Scenario: An instruction read from a column rather than written in the query is refused
    Given a statement calling eval with a column as its instructions
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

  # ---------------------------------------------------------------------------
  # Gating
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An eval function is refused while the flag is off for the project
    Given the Instant Evals flag is off for the project
    When a statement calling eval is validated
    Then it is refused with APP_FUNCTION_GATED
    And the message says the feature is not open to this project

  @unit
  Scenario: An eval function is refused when the deployment has no classifier
    Given no classifier is configured for the deployment
    When a statement calling eval is validated
    Then it is refused with APP_FUNCTION_GATED

  @unit
  Scenario: The schema publishes eval functions as unavailable while they are gated
    Given the Instant Evals flag is off for the project
    When the schema endpoint is asked for the functions section
    Then every eval function is listed with available false
    And the extraction functions keep the availability their permissions give them

  @unit
  Scenario: An eval function still needs the content permissions its text carries
    Given a caller who does not hold the captured-output permission
    When a statement calling eval over a conversation is validated
    Then it is refused with APP_FUNCTION_GATED

  # ---------------------------------------------------------------------------
  # Budget, failure and cost
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A query whose text volume exceeds the per-query budget is refused
    Given a statement whose rows would send more tokens than the per-query budget allows
    When it is executed
    Then it is refused with instant_eval_query_budget_exceeded
    And the refusal names the estimated tokens and the budget
    And the remediation tells the caller to run the statement as a job

  @unit
  Scenario: A classifier that fails for the whole query is a platform refusal
    Given a classifier that refuses every request
    When a statement calling eval is executed
    Then it is refused with instant_eval_classifier_unavailable
    And the fault is recorded as the provider's

  @unit
  Scenario: A row the classifier could not judge is skipped rather than guessed
    Given a classifier that refuses one row of five and answers the rest
    When the statement is hydrated
    Then that row's judged columns are null
    And the result carries the INSTANT_EVAL_SKIPPED diagnostic naming one row
    And the other four rows hold their answers

  @unit
  Scenario: A statement that judges nothing resolves no gate and builds no classifier
    Given a statement that calls no eval function
    When it is executed
    Then the project's Instant Evals gate is never resolved
    And no classifier is built for the query

  @unit
  Scenario: A text the classifier failed on is skipped, not reported as a missing key
    Given a classifier that drops one text of two and answers the other
    When the statement is hydrated
    Then the dropped row's judged column is null
    And the result reports one skipped judgement naming the classifier failure
    And no key is reported as unresolved, because both keys found their text

  @unit
  Scenario: A cancelled query stops judging instead of paying out the rest
    Given a query being judged row by row
    When the caller cancels it
    Then no further text is sent to the classifier
    And the cancellation reaches the request already in flight
    And the query fails as cancelled rather than answering with null columns

  @unit
  Scenario: A query that judged nothing reports no spend
    Given a statement whose every key resolved to no text
    When it is executed
    Then no spend record is reported

  @unit
  Scenario: One spend record is reported per query
    Given a statement that judged three conversations
    When it is executed
    Then one spend record is reported for the project with the classifier's input tokens
    And it names no run, because a synchronous query has none
    And its cost is the classifier's own cost
    And the customer price carries the platform markup

  # ---------------------------------------------------------------------------
  # Against a real server
  # ---------------------------------------------------------------------------

  @integration
  Scenario: The eval functions are provisioned as projection UDFs like every other app function
    When the shipped provisioning statements have been applied
    Then the server holds an eval function for every declared name
    And each one is reported as our own SQL user-defined function

  @integration
  Scenario: A statement calling an eval function is recorded verbatim and hands back its text
    Given a statement projecting eval over a column, with a trailing comment
    When it runs as the restricted identity
    Then the server's query log holds the submitted text byte for byte, comment included
    And the column carries the text the call was given, which is what the application judges
