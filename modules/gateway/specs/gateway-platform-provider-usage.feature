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
  Scenario: A ledger that cannot take the usage never fails the evaluation
    Given the spend pipeline refuses the usage
    When an evaluation answers with a verdict
    Then the verdict is returned unchanged
    And the refusal is logged with every figure it carried

  @unimplemented
  Scenario: A workflow or playground call through the in-process gateway lands on the ledger
    Given a studio workflow node or playground prompt running on stored credentials in nlpgo
    When the provider answers
    Then its usage lands on the ledger under the project and provider row

  @unimplemented
  Scenario: An own Instant Evals decision model records the provider tokens it used
    Given an organization judging with its own decision model
    When a classification answers
    Then the provider tokens land on the ledger as decision model spend
    And the Instant Evals customer price stays unchanged
