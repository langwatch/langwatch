Feature: The gateway registers its own spend pipeline
  gateway_spend_processing is the gateway module's pipeline, declared with withEventing
  (ARCHITECTURE §9, WP-6b). The api sends onto it; the worker folds the spend ledger.

  @unit
  Scenario: The spend pipeline is registered in both roles
    Given the gateway module installed with its members
    When its eventing is built for the api and for the worker
    Then both builds name gateway_spend_processing
    And the worker's build folds into the ClickHouse spend ledger

  @unit
  Scenario: Each committed spend step is handed to webhook delivery under its own event id
    Given the worker's spend pipeline built with webhook's delivery operation
    When a confirmed spend event reaches its webhook subscriber
    Then webhook delivery is asked once, named by the event's idempotency key
    And the request carries the spend step's type and data unchanged

  @unit
  Scenario: The worker's spend pipeline hosts the settlement sweeper and the api's does not
    Given the gateway module installed with its members
    When its eventing is built for the api and for the worker
    Then the worker's build hosts the settlement sweeper, woken every five minutes
    And the api's build hosts no process manager

  @unit
  Scenario: The sweeper settles through the spend pipeline's own registered command
    Given the worker's spend pipeline connected to its registered senders
    And an admission open past its grace on a private ClickHouse server
    When the settlement sweep runs
    Then the settle command for that admission is sent through the registered settleSpend sender
    And the shared server and each distinct private server are read once

  @unit
  Scenario: An unreachable ClickHouse server does not cost the other servers' settlements
    Given the worker's spend pipeline connected to its registered senders
    And a private ClickHouse server that refuses the read
    When the settlement sweep runs
    Then the admission open on the shared server is still settled

  @unit
  Scenario: The worker's spend fold reads through the Redis fold cache under main's keyspace
    Given the worker's spend pipeline built over the process's Redis
    When the fold reads one request's spend state
    Then Redis is asked first, under the gateway_spend keyspace every role shares
    And a cache miss falls through to the spend ledger

  @unit
  Scenario: The worker's spend pipeline hosts the gateway's budget debits
    Given the gateway module installed with its members
    When its eventing is built for the api and for the worker
    Then the worker's build hosts gatewayDebits, the name its stored rows are keyed by
    And the api's build does not

  @unit
  Scenario: Spend debits every budget the request applies to
    Given a confirmed request whose target resolves an every-provider budget and two provider budgets
    When its debits are written
    Then one ledger row lands for the every-provider budget and one for the request's own provider
    And the budget scoped to another provider is not debited
    And one budget-updated signal names the debited budgets

  @unit
  Scenario: A debit that fails to land is retried rather than dropped
    Given the budget ledger refuses the insert
    When a request's debits are written
    Then the write fails, so the outbox retries it
    And no budget-updated signal is appended for rows that never landed

  @unit
  Scenario: An admission without an outcome debits nothing
    Given an admitted request whose outcome has not arrived
    When the debits process consumes the admission
    Then no debit intent is committed and the request's attribution is remembered
    And an outcome that moved no money and no quantity commits no debit either
