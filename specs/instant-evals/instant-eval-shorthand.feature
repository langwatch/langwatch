Feature: The Instant Eval shorthand, a target and a filter expanded into one statement

  As an AI engineer or an agent who has a question but not a statement yet
  I want to name a target, a trace filter and my questions
  So that the platform writes the LangWatchQL statement for me and hands it back to me to edit

  Issue: Instant Evals, PR 5. ADR-137 amendment.

  The shape:
  - `POST /api/v1/instant-evals` and `POST /api/v1/instant-evals/estimate` take either a
    statement (`sql`) or a shorthand (`target` plus `questions`), never both.
  - The shorthand is expanded on the server into ONE LangWatchQL statement from a template
    per target, and that statement goes through the same acceptance gate a hand-written one
    does. Nothing about the run is different afterwards.
  - The expanded statement is returned on the run record as `sql` and by the estimate, so a
    caller can copy it, edit it and resubmit it to `POST /api/v1/query` or to a run. The
    shorthand teaches the primitive rather than hiding it.
  - The trace filter is compiled into the statement as LangWatchQL text with its values
    carried as bound parameters. Only the filter fields the LangWatchQL trace view can
    answer are supported; any other field is refused by name, with the statement door named
    as the way to ask it.

  Background:
    Given a project whose key carries analytics:view and analytics:manage
    And the Instant Evals flag is on for that project

  # ---------------------------------------------------------------------------
  # Choosing between the statement and the shorthand
  # ---------------------------------------------------------------------------

  @integration
  Scenario: A request carrying a target and no statement is expanded
    Given a request naming the traces target and one boolean question
    When it is submitted to the run endpoint
    Then the response is 202
    And the run's statement selects from the LangWatchQL traces view
    And the run's questions are the ones the expansion wrote into the statement

  @integration
  Scenario: A request carrying both a statement and a target is refused
    Given a request carrying both sql and target
    When it is submitted to the run endpoint
    Then the response is 422 with code instant_eval_query_invalid
    And the refusal says to send one of the two

  @integration
  Scenario: A request carrying neither a statement nor a target is refused
    Given a request carrying neither sql nor target
    When it is submitted to the run endpoint
    Then the response is 422 with code instant_eval_query_invalid
    And the refusal names both sql and target

  @unit
  Scenario: A shorthand with no question is refused before anything is expanded
    Given a shorthand naming a target and an empty question list
    When the request is read
    Then it is refused as invalid
    And the refusal says at least one question is required

  # ---------------------------------------------------------------------------
  # The templates
  # ---------------------------------------------------------------------------

  @unit
  Scenario: The traces target judges the readable trace of each trace
    Given a shorthand naming the traces target
    When it is expanded
    Then the statement selects TraceId, the conversation id as ThreadId and OccurredAt
    And each question is an eval function over llm_readable_trace of the trace id
    And the statement orders by TraceId

  @unit
  Scenario: The threads target judges one bounded transcript per conversation
    Given a shorthand naming the threads target
    When it is expanded
    Then the statement selects from the LangWatchQL trace metrics view
    And it groups by ConversationId and projects the conversation's last trace as TraceId
    And each question is an eval function over conversation_bounded of the conversation id
    And rows with no conversation id are left out

  @unit
  Scenario: The llm_spans target judges the messages of each model call
    Given a shorthand naming the llm_spans target
    When it is expanded
    Then the statement selects from the LangWatchQL spans view
    And it keeps only spans whose type is llm
    And each question is an eval function over llm_messages_span of the trace and span
    And the statement orders by TraceId and SpanId, which is what the run pages by

  @unit
  Scenario: The text budget comes from what the questions leave of the classifier's state
    Given a shorthand whose questions are long enough to crowd the classifier's state
    When it is expanded
    Then the token budget written into the extraction call is what the questions leave
    And a shorthand with short questions gets the shipped default instead

  @unit
  Scenario: A time window is always written into the statement as bound instants
    Given a shorthand with no start and no end
    When it is expanded
    Then the statement bounds its time column between two bound parameters
    And the parameters hold absolute instants rather than a relative expression
    And the window covers the last seven days

  @unit
  Scenario: A window narrower than a second keeps both of its ends
    Given a shorthand whose start and end fall inside the same second
    When it is expanded
    Then the two bound instants keep their milliseconds
    And they are not the same instant

  # ---------------------------------------------------------------------------
  # The questions
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A boolean question becomes an eval call
    Given a boolean question with instructions and nothing else
    When it is expanded
    Then the statement calls eval with the instructions
    And the column is aliased to the question's id

  @unit
  Scenario: A boolean question with two criteria becomes an eval_criteria call
    Given a boolean question carrying what counts as yes and what does not
    When it is expanded
    Then the statement calls eval_criteria with both criteria in order

  @unit
  Scenario: A boolean question with a threshold becomes an eval_passed call
    Given a boolean question carrying a threshold
    When it is expanded
    Then the statement calls eval_passed with that threshold

  @unit
  Scenario: A boolean question carrying both criteria and a threshold is refused
    Given a boolean question carrying criteria and a threshold together
    When it is expanded
    Then it is refused as invalid
    And the refusal names the two forms and says to pick one

  @unit
  Scenario: A score question becomes an eval_score call over its range
    Given a score question with a range from one to five
    When it is expanded
    Then the statement calls eval_score with both ends of the range

  @unit
  Scenario: A category question becomes an eval_category call over its options
    Given a category question with three named options
    When it is expanded
    Then the statement calls eval_category with each option written as name and description

  @unit
  Scenario: A question with no id of its own is named by its position
    Given a shorthand with two questions and no ids
    When it is expanded
    Then the first column is named q1 and the second q2

  @unit
  Scenario: A question id that is not a plain column name is refused
    Given a question whose id carries a quote
    When it is expanded
    Then it is refused as invalid
    And the refusal says an id is a column name

  @unit
  Scenario: A question id colliding with a key column is refused
    Given a question whose id is TraceId
    When it is expanded
    Then it is refused as invalid
    And the refusal names the columns the statement already projects

  @unit
  Scenario: Two questions sharing an id are refused
    Given a shorthand with two questions named the same
    When it is expanded
    Then it is refused as invalid
    And the refusal names the repeated id

  @unit
  Scenario: Instructions carrying a quote survive the expansion
    Given a question whose instructions carry a single quote and a backslash
    When it is expanded
    Then the statement escapes both and still parses
    And the accepted statement's question carries the instructions unchanged

  # ---------------------------------------------------------------------------
  # The trace filter
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A supported filter field is compiled into the statement's WHERE
    Given a filter naming the service
    When the shorthand is expanded
    Then the statement's WHERE carries the service condition
    And the service name is a bound parameter rather than text in the statement

  @unit
  Scenario: A wildcard model value keeps its literal LIKE characters
    Given a filter asking for a model whose name carries an underscore, a percent sign or a backslash, with a wildcard
    When the filter is compiled
    Then each of those characters is escaped in the bound pattern
    And only the caller's wildcard matches anything

  @unit
  Scenario: Free text keeps its literal LIKE characters
    Given a bare word carrying an underscore, a percent sign or a backslash
    When the filter is compiled
    Then each of those characters is escaped in the bound pattern
    And only the surrounding wildcards the compiler adds match anything

  @unit
  Scenario: A filter field the trace view cannot answer is refused by name
    Given a filter naming an evaluator result
    When the shorthand is expanded
    Then it is refused as invalid
    And the refusal names the field and lists the fields a shorthand does support
    And it says a statement can ask what a shorthand cannot

  @unit
  Scenario: A filter the language cannot parse is refused
    Given a filter with unbalanced brackets
    When the shorthand is expanded
    Then it is refused as invalid
    And the refusal says the filter could not be read

  @unit
  Scenario: Boolean operators and negation are compiled
    Given a filter combining two fields with OR and negating a third
    When the shorthand is expanded
    Then the statement's WHERE carries the same structure

  @unit
  Scenario: A trace attribute is compiled through the attribute map
    Given a filter naming a trace attribute
    When the shorthand is expanded
    Then the statement reads that key off the Attributes map
    And both the key and the value are bound parameters

  @unit
  Scenario: A filter on a target other than traces is applied through a trace subquery
    Given a shorthand naming the threads target and a filter naming the service
    When it is expanded
    Then the statement keeps only traces the filter matches, through a subquery on the trace view
    And the subquery bounds its own time column

  @unit
  Scenario: A question list over the ceiling is refused by its count
    Given a shorthand carrying more questions than one classification may ask
    When it is read
    Then it is refused for the number of questions, not for the room they leave

  @unit
  Scenario: A question written as whitespace is refused
    Given a shorthand whose question carries nothing but spaces
    When it is read
    Then it is refused rather than sent to the classifier as an empty prompt

  @unit
  Scenario: A label is decoded before it is compared
    Given a shorthand filter naming a label
    When it is compiled
    Then each element of the encoded label list is decoded before the comparison

  @unit
  Scenario: A filtered threads statement names the view's own trace column
    Given a shorthand naming the threads target and a filter naming the service
    When it is expanded
    Then the subquery reads the trace column the view carries, not the aggregate the statement projects

  @unit
  Scenario: A filtered llm-spans statement reads its own plain trace column
    Given a shorthand naming the llm-spans target and a filter naming the service
    When it is expanded
    Then the subquery reads the span view's unqualified trace column

  @unit
  Scenario: A shorthand with no filter writes no filter condition
    Given a shorthand with no filter
    When it is expanded
    Then the statement's WHERE carries the time window and nothing of a filter

  # ---------------------------------------------------------------------------
  # The expansion is held to the same bar as a hand-written statement
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An expanded statement passes the statement gate unchanged
    Given a shorthand for every one of the three targets
    When each is expanded
    Then each statement is accepted by the same gate a submitted statement goes through
    And each declares only parameters its own expansion binds, the window among them

  @integration
  Scenario: The estimate answers for a shorthand too
    Given a shorthand naming the threads target
    When it is submitted to the estimate endpoint
    Then the response carries rows, tokens, cost and price
    And nothing is judged

  @unit
  Scenario: The run hands the expanded statement back
    Given a shorthand that was accepted
    When the run is read
    Then its sql is the expanded statement
    And its parameters are the ones the expansion bound
