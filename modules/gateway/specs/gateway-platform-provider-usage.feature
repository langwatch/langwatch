Feature: Platform calls on stored provider credentials land on the spend ledger
  LangWatch itself calls models with an organization's stored model provider
  credentials: evaluators, topic clustering embeddings and naming, decision
  models. Each call's usage lands on the gateway spend ledger under its project,
  team, organization and provider row, rated against the model registry, so the
  provider bill, the ledger and the budgets agree (ADR-193).

  @unit
  Scenario: A platform call on stored provider credentials lands on the ledger and debits its budgets
    Given a project in a team of an organization with a stored OpenAI provider
    When langevals reports that a call used 1,000,000 input tokens of openai/text-embedding-3-large
    Then the registry rates those tokens
    And one confirmed outcome lands with the project, team, organization and provider row
    And it names no virtual key, so every project, team and organization budget it falls under is debited

  @unit
  Scenario: A platform call that names no provider row is attributed to the row serving its model
    Given a platform call whose caller did not name the provider row
    When its usage is recorded
    Then it is attributed to the stored row serving its model for the project
    And with no such row, to the project's execution row for the provider

  @unit
  Scenario: A platform call for a project with no team is reported, not written half attributed
    Given a platform call for a project that no longer resolves to a team
    When its usage is recorded
    Then nothing is written to the ledger
    And the answer says the usage was unattributed

  @unit
  Scenario: An evaluator entry reports the provider usage of its model calls
    Given an evaluator whose entry calls its judge model, retries included
    When the entry finishes, whether processed, skipped or failed
    Then its result carries the usage of every call, summed per model
    And the platform writes it to the ledger keyed by the evaluation's idempotency key and model

  @unit
  Scenario: A topic clustering run reports the provider usage of its embeddings
    Given a clustering request that embeds its traces and names its topics
    When it answers
    Then the answer carries the embedding and naming usage, summed per model
    And the platform writes it to the ledger as topic_clustering spend

  @unit
  Scenario: A retried topic clustering page reports its provider usage under the same request id
    Given a clustering page of an outbox run that langevals answered
    When the page is retried and langevals answers again
    Then both reports carry the request id of that run and page
    And the ledger keeps one row for it

  @unit
  Scenario: A ledger that cannot take the usage never fails the evaluation
    Given the spend pipeline refuses the usage
    When an evaluation answers with a verdict
    Then the verdict is returned unchanged
    And the refusal is logged with every figure it carried

  @unit
  Scenario: A platform feature or playground call through the execution proxy lands on the ledger
    Given a LangWatch feature or the prompt playground calling a model on stored credentials through nlpgo
    When the provider answers, generated or streamed
    Then its usage lands on the ledger under the project and provider row
    And the provider's response id keys the row

  @unit
  Scenario: A studio workflow's LLM nodes on stored credentials land on the ledger
    Given a studio workflow whose LLM node runs on the project's stored provider credentials
    When the engine reports the node's token usage on a streamed run, an evaluated row or a synchronous answer
    Then that usage lands on the ledger as workflow spend under the project and the node's model
    And its request id names the trace, workflow, node and model, so a repeat is one row
    And cached prompt tokens are counted apart from the fresh input tokens

  @unit
  Scenario: An evaluated studio row reports its LLM usage on its own progress event
    Given a studio evaluation over a dataset whose rows run an LLM node
    When each row finishes
    Then that row's progress event carries the node's token usage under the row's own trace id

  @unit
  Scenario: A ledger refusal never fails the workflow
    Given the spend pipeline refuses or fails on a workflow node's usage
    When the workflow run answers
    Then the run's events and answer reach the caller unchanged
    And the refusal is logged with every figure it carried

  @unit
  Scenario: An own Instant Evals decision model records the provider tokens it used
    Given an organization judging with its own decision model
    When a classification answers
    Then the provider tokens land on the ledger as instant_eval_decision_model spend
    And the Instant Evals customer price stays zero
    And a ledger refusal is logged and keeps the verdict
