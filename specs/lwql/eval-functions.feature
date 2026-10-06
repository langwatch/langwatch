Feature: LangWatchQL eval functions — a judged column, read by the query and judged by a run

  As an agent or an engineer writing LangWatchQL
  I want to ask a question of every conversation a statement selects and get a calibrated answer per row
  So that I can search production history by meaning instead of by keyword, in one statement

  Issue: Instant Evals, PR 2b. ADR-136 (amended), ADR-153.

  What the eval functions are:
  - `eval`, `eval_criteria`, `eval_passed`, `eval_score`, `eval_category` and
    `eval_category_probs` are app functions like the extraction ones: a projection UDF in
    ClickHouse, projection-only, alias required.
  - Their key is the text to judge. It is normally another app function, so an eval
    function may nest an extraction function one level deep, the only nesting the
    validator allows anywhere.
  - A query never judges. The eval column of a query answers with the text that would be
    judged. A judgement is made by an Instant Eval run (ADR-153), which pages the same
    statement, reads the text through the extraction functions and asks the classifier.
    The judging itself (one request per text, budgets, cancellation, spend) is specified in
    modules/instant-eval/specs/instant-eval-pipeline.feature, classifier.feature and
    instant-eval-cost.feature. Judging inside the query is an idea that was never built
    (ADR-136, "Ideas not built").

  Background:
    Given a project whose credential holds analytics:view
    And the caller holds the captured-input and captured-output permissions
    And the Instant Evals flag is on for the project
    And a classifier is configured for the deployment

  # ---------------------------------------------------------------------------
  # What a statement may say
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An eval function used outside the projection is told what to do instead
    Given a statement calling eval in its WHERE clause
    When the statement is validated
    Then it is refused for the position the call is in
    And the refusal does not tell the caller to filter on a plain column, because an eval answers after the query runs
    And it says to filter the rows the statement returns, or to run it as an Instant Eval and read the matched results

  @unit
  Scenario: An extraction function used outside the projection keeps its advice
    Given a statement calling conversation in its WHERE clause
    When the statement is validated
    Then it is refused for the position the call is in
    And the refusal tells the caller to project it and filter, group or sort on a plain column

  @unit
  Scenario: One question over an extracted conversation is accepted and planned
    Given a statement selecting eval(conversation(ConversationId), 'The customer sounds annoyed') AS annoyed
    When the statement is validated
    Then it is accepted
    And the hydration plan names the column "annoyed", the function "eval" and the nested function "conversation"

  @unit
  Scenario: An eval over a plain column needs no extraction read
    Given a statement selecting eval(CapturedOutput, 'The answer is an apology') AS apology
    When the statement is validated
    Then it is accepted
    And the plan records no nested function, because the column already holds the text

  # ---------------------------------------------------------------------------
  # What a query hands back
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An eval written over an extraction is read as that extraction
    Given a hydration plan holding eval over conversation in the column "transcript"
    When the extraction half of the plan is taken
    Then the column holds the conversation call

  @unit
  Scenario: An eval written over a plain expression is left to the column
    Given a hydration plan holding eval over a plain column
    When the extraction half of the plan is taken
    Then the call is dropped, because the column already holds the text

  @unit
  Scenario: A page read for a run holds the text that would be judged, not a verdict
    Given a statement projecting eval over conversation, and one trace id
    When the page is read for judging
    Then the judged column holds the conversation text
    And no classifier was called

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

  @unit
  Scenario: Sorting by an eval's alias is refused rather than sorting by the text it judges
    Given a statement projecting eval_score(CapturedOutput, 'How polite', 1, 5) AS s
    When it orders by s, or by the eval's position in the SELECT list
    Then it is refused with APP_FUNCTION_POSITION
    And the message says to run the eval first and sort over analytics.judgments
    And ordering the same statement by TraceId is accepted

  @unit
  Scenario: Grouping or filtering on an eval's alias is refused
    Given a statement projecting eval_score(CapturedOutput, 'How polite', 1, 5) AS s
    When it names s in GROUP BY, HAVING or WHERE
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

  # A judgement is charged to a project. A key that reads several has no single
  # owner for the bill, so judging is refused for it rather than attributed to
  # whichever project the key happened to list first.
  @unit
  Scenario: An eval function is refused for a key that reads more than one project
    Given a key that can read two projects
    And the Instant Evals flag is on for both of them
    When the caller asks whether Instant Evals are open to it
    Then the answer is no

  @unit
  Scenario: A key that reads one project is judged on that project's own flag
    Given a key that can read one project
    And the Instant Evals flag is on for it
    When the caller asks whether Instant Evals are open to it
    Then the answer is yes

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

  # ---------------------------------------------------------------------------
  # What the published examples teach
  # ---------------------------------------------------------------------------

  # Agents copy the published example. A question about what the agent did is
  # decided by a tool result, which `conversation` names but does not hold.
  @unit
  Scenario: The eval function examples judge the thread's steps view
    Given the published eval function catalog
    When each eval function's example is read
    Then its text is llm_readable_thread over the conversation
    And no example judges the chat-only conversation view
