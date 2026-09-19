Feature: LangWatchQL app-side extraction functions — projection UDFs plus a post-execution hydration stage

  As an agent or an engineer writing LangWatchQL
  I want to project the text of a conversation, a trace or an LLM call straight out of a query
  So that I can read, export and later judge production history without writing a second program

  Issue: Instant Evals, PR 2. ADR-136.

  The mechanism, and why it is two halves:
  - Each app function exists in ClickHouse as a pure projection SQL UDF over its key
    arguments: the identity on its first argument for a single-key function, `tuple(...)`
    for the one function whose key is a pair. So the submitted SQL still runs verbatim
    under the row policy (the "Submitted SQL is never automatically rewritten" scenario in
    lwql-api.feature still holds) and the returned column already carries the key.
  - After execution the application reads the keys out of that column, fetches the traces
    or threads they name through the tenant-scoped trace services with the caller's own
    protections, computes the value, and overwrites the key with it.

  The correctness rule the database cannot enforce:
  - ClickHouse accepts a projection UDF in WHERE, GROUP BY, ORDER BY, HAVING, a join
    condition, a CTE, a subquery and inside a lambda, and answers with the *key* compared
    as if it were the *value*: a silently wrong answer, never an error. Measured on
    25.8, `WHERE conversation(ConversationId) = 'x'` returned the row whose key is 'x'.
    Projection-only is therefore the validator's rule, and every other position is a
    named refusal rather than a general one.

  Background:
    Given a project whose credential holds analytics:view
    And the caller holds the captured-input and captured-output permissions

  # ---------------------------------------------------------------------------
  # The golden path
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A conversation is projected under an alias and hydrated into the result
    Given a statement selecting conversation(ConversationId) AS transcript from the trace metrics dataset
    When the statement is validated
    Then it is accepted
    And the hydration plan names the column "transcript" and the function "conversation"

  @unit
  Scenario: A statement that calls no app function records an empty plan
    Given a statement selecting only ordinary columns
    When the statement is validated
    Then it is accepted with an empty hydration plan

  @unit
  Scenario: The hydrated column carries the rendered conversation, not the thread key
    Given two traces recorded under one conversation id
    When a statement projecting conversation(ConversationId) AS transcript is hydrated
    Then the column holds the conversation markdown, with the system prompt once and one section per turn
    And the column type is reported as the hydrated type rather than the key's type

  @integration
  Scenario: Submitted SQL using an app function is still recorded verbatim
    Given a statement projecting llm_readable_trace(TraceId, 8000) AS text with a trailing comment
    When it runs as the restricted identity
    Then the server's query log holds the submitted text byte for byte, comment included

  @unit
  Scenario: Every catalogued function is published with a runnable example
    When the schema endpoint is asked for the functions section
    Then every function carries its signature, return type, value encoding, key cap and gates
    And every published example is accepted by the validator

  # ---------------------------------------------------------------------------
  # Position: the rule the database will not enforce
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An app function in WHERE is refused rather than silently comparing the key
    Given a statement filtering on conversation(ConversationId) = 'anything'
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION
    And the same statement with the call moved into the projection is accepted

  @unit
  Scenario Outline: An app function outside the outermost projection is refused
    Given a statement calling llm_messages(TraceId) in <position>
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION

    Examples:
      | position                    |
      | a GROUP BY expression       |
      | an ORDER BY expression      |
      | a HAVING expression         |
      | a join condition            |
      | a subquery's projection     |
      | a common table expression   |
      | a lambda body               |
      | a nested function argument  |
      | an APPLY column transformer |

  @unit
  Scenario: An app function nested inside another app function is refused
    Given a statement projecting conversation(thread_traces(ConversationId)) AS x
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION

  @unit
  Scenario: An app function in a UNION branch is refused
    Given a statement whose two UNION ALL branches each project llm_messages(TraceId) AS m
    When the statement is validated
    Then it is refused with APP_FUNCTION_POSITION
    And the refusal says app functions read the top-level SELECT list of a single statement

  # ---------------------------------------------------------------------------
  # Alias and arguments
  # ---------------------------------------------------------------------------

  @unit
  Scenario: An app function written in another capitalisation is refused
    Given a statement projecting CONVERSATION(ConversationId) AS transcript
    When the statement is validated
    Then it is refused with APP_FUNCTION_NAME_CASE
    And the refusal names the spelling to use, because the query is never rewritten

  @unit
  Scenario: A call with no alias is refused
    Given a statement projecting conversation(ConversationId) with no AS clause
    When the statement is validated
    Then it is refused with APP_FUNCTION_ALIAS_REQUIRED

  @unit
  Scenario Outline: A call whose arguments do not match the signature is refused
    Given a statement projecting <call> AS x
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT

    Examples:
      | call                                          |
      | conversation()                                |
      | conversation(ConversationId, 1)               |
      | llm_readable_trace(TraceId)                   |
      | conversation_bounded(ConversationId, 8000)    |
      | llm_readable_trace(TraceId, MaxTokensColumn)  |
      | llm_readable_trace(TraceId, {budget:UInt32})  |

  @unit
  Scenario: A key argument may be any expression the policy already allows
    Given a statement projecting llm_readable_trace(concat(TraceId, ''), 8000) AS text
    When the statement is validated
    Then it is accepted

  @unit
  Scenario: A call in the parametric form is refused
    Given a statement projecting conversation(1)(ConversationId) AS c
    When the statement is validated
    Then it is refused with APP_FUNCTION_ARGUMENT naming conversation
    And the same form on an extraction nested inside an eval is refused the same way

  @unit
  Scenario: A gated column inside a key expression is still refused
    Given a caller without the captured-input permission
    And a statement projecting thread_traces(CapturedInput) AS ids
    When the statement is validated
    Then it is refused with GATED_COLUMN

  # ---------------------------------------------------------------------------
  # Gates
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A function whose gates the caller does not hold is refused
    Given a caller without the captured-output permission
    And a statement projecting conversation(ConversationId) AS transcript
    When the statement is validated
    Then it is refused with APP_FUNCTION_GATED
    And the refusal names the permission that would unlock it

  @unit
  Scenario: The schema lists a gated function rather than hiding it
    Given a caller without the captured-output permission
    When the schema endpoint is asked for the functions section
    Then conversation is listed with available false and its gates named

  # ---------------------------------------------------------------------------
  # Caps
  # ---------------------------------------------------------------------------

  @unit
  Scenario: More distinct trace keys than the cap allows is a refusal, not a partial answer
    Given a result carrying more distinct trace ids than the trace cap
    When hydration runs
    Then it fails with lwql_app_function_key_cap
    And the error names the cap and the key kind that exceeded it

  @unit
  Scenario: More distinct thread keys than the thread cap allows is refused the same way
    Given a result carrying more distinct conversation ids than the thread cap
    When hydration runs
    Then it fails with lwql_app_function_key_cap

  @unit
  Scenario: Repeated keys cost nothing against the cap
    Given a result whose rows repeat one trace id far past the cap
    When hydration runs
    Then it succeeds, because the cap counts distinct keys

  @unit
  Scenario: A page of conversations never loses a trace to the read's ceiling
    Given two hundred conversations holding more than a thousand traces between them
    When their traces are read for hydration
    Then the read's ceiling is sized by the conversations asked for
    And no conversation's traces are dropped

  # ---------------------------------------------------------------------------
  # Truncation and unresolved keys
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A hydrated result past the byte ceiling drops trailing rows and says so
    Given hydrated values whose total exceeds the hydrated-bytes ceiling
    When hydration runs
    Then the trailing rows are dropped
    And the result is marked truncated
    And it carries RESULT_TRUNCATED with meta.ceiling "hydratedBytes"

  @unit
  Scenario: The result ceiling counts encoded bytes, not characters
    Given hydrated transcripts written in a script that costs several bytes per character
    When the hydrated result is measured against the byte ceiling
    Then the ceiling holds at the same number of bytes as it would for ASCII

  @unit
  Scenario: A single value past the per-value ceiling is cut and reported
    Given one hydrated value larger than the per-value ceiling
    When hydration runs
    Then that value is cut on a character boundary so its encoded length is at or under the ceiling
    And the result carries APP_FUNCTION_VALUE_TRUNCATED naming the function and how many values were cut

  @unit
  Scenario: A key that resolves to nothing hydrates to null and is reported
    Given a row whose conversation id matches no trace
    When hydration runs
    Then the column is null for that row
    And the result carries APP_FUNCTION_UNRESOLVED_KEYS naming the function and the count

  @unit
  Scenario: A span the trace does not hold is an unresolved key
    Given a row naming a trace that exists and a span id it does not carry
    When hydration runs
    Then the column is null for that row
    And the key is counted in APP_FUNCTION_UNRESOLVED_KEYS
    And a span that exists but carries no messages is not counted

  @unit
  Scenario: A null key is not an unresolved key
    Given a row whose conversation id is null
    When hydration runs
    Then the column is null for that row
    And no unresolved-keys diagnostic is reported, because there was no key to resolve

  # ---------------------------------------------------------------------------
  # The fallback chain the production data needs
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A turn with no computed content falls back to the trace's LLM span messages
    Given a thread whose traces carry no computed input or output
    And whose LLM spans carry chat messages
    When conversation hydrates
    Then the rendered conversation holds the text from those messages

  @unit
  Scenario: Questions that leave no room for text are refused before anything is judged
    Given eval questions that alone fill the judge's state
    When the statement is hydrated
    Then it fails with instant_eval_questions_too_long and nothing is sent to the judge

  @unit
  Scenario: A conversation over the judge's budget is measured with the judge's own ratio
    Given a conversation that fits four bytes a token but not the judge's denser ratio
    When the statement is hydrated
    Then it is re-rendered under the judge's budget before it is sent
    And the row is reported truncated

  @unit
  Scenario: A bounded conversation keeps both ends and names what it dropped
    Given a thread whose turns do not fit the requested token budget
    When conversation_bounded hydrates
    Then the opening and closing turns are kept
    And a marker names how many turns were omitted

  # ---------------------------------------------------------------------------
  # Failure
  # ---------------------------------------------------------------------------

  @unit
  Scenario: A cancelled query keeps the judgements it made
    Given a judged query whose caller cancels after one row was answered
    When hydration returns
    Then the answered verdict and its usage are kept
    And the result names the rows that were never judged

  @unit
  Scenario: A read past the byte budget is refused, not completed
    Given a page whose traces together hold more bytes than one read may fetch
    When their traces are read for hydration
    Then the read stops at the budget and fails with lwql_app_function_read_budget
    And the error names the budget and how much had been read

  @unit
  Scenario: A cancelled read stops between chunks
    Given a page of traces read in chunks
    When the caller cancels after the first chunk
    Then no further chunk is read

  @unit
  Scenario: A failed fetch is a platform failure, not a wrong answer
    Given the trace service throws while hydrating
    When the query runs
    Then it fails with lwql_app_function_hydration_failed
    And the fault is recorded as the platform's

  @unit
  Scenario: A query using an app function against a server with no such function refuses clearly
    Given ClickHouse answers UNKNOWN_FUNCTION for a catalogued app function
    When the query runs
    Then it fails with lwql_app_function_unavailable rather than an unknown error

  @unit
  Scenario: An unknown native function is not reported as a missing app function
    Given a statement that calls no app function
    And ClickHouse answers UNKNOWN_FUNCTION because the server is too old for a native one
    When the query runs
    Then the refusal is the ordinary translation, not lwql_app_function_unavailable

  # ---------------------------------------------------------------------------
  # Provisioning
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Every catalogued function has a create statement derived from its own signature
    When the provisioning statements are built
    Then each function is created as a pure projection over its key arguments
    And a function whose key is a pair is created as a tuple of both

  @unit
  Scenario: The reconciliation query asks about exactly the declared names
    When the reconciliation query is built
    Then it names every catalogued function and nothing else

  @unit
  Scenario: A declared name the server already owns is reported rather than accepted
    Given the server reports a catalogued name with an origin other than SQLUserDefined
    When the reconciliation reads that answer
    Then it reports that name as a conflict

  @unit
  Scenario: A declared name held by somebody else's UDF is not overwritten
    Given the server holds a SQL function with a declared name and a different body
    When the declared names are reconciled
    Then that name is reported as a conflict rather than replaced
    And a function whose stored body is the one we generate is not reported

  @integration
  Scenario: Provisioning the functions twice leaves the same definitions
    Given the app-function statements applied once
    When they are applied again
    Then every function still reports origin SQLUserDefined
    And no statement fails

  @integration
  Scenario: The restricted identity may call an app function but never manage one
    Given the app functions are provisioned
    When the restricted identity selects one in a projection
    Then the query succeeds
    And creating, replacing, dropping or reloading a function is refused with ACCESS_DENIED

  @integration
  Scenario: An app function does not widen what a tenant can read
    Given tenant A's key context
    When a statement projecting llm_readable_trace(TraceId, 8000) AS text runs
    Then every returned row belongs to tenant A

  @unit
  Scenario: A replicated chart-managed server stores the functions in Keeper
    Given a chart-managed ClickHouse rendered in replicated mode with a LangWatchQL password
    When the LangWatchQL server config is rendered
    Then it declares a user_defined_zookeeper_path so one create reaches every replica

  @unit
  Scenario: A single-node server stores them on local disk
    Given a chart-managed ClickHouse rendered without replication
    When the LangWatchQL server config is rendered
    Then no user_defined_zookeeper_path is declared
