Feature: Composing the monthly billing roll-up

  Every billable event the meter counts is worth nothing until a month's total
  reaches Stripe. That is the roll-up's job: read the month's deduplicated
  total, compare it against a durable checkpoint, send the delta as one meter
  event, and re-dispatch itself to walk the month forward.

  Only the App could compose it. The organization read lived in the App's own
  organization service, the read-through cache was a process-wide cache the App
  built for itself, the ClickHouse total went through a client the App
  resolved, and the Stripe sender was a client the App constructed from its own
  configuration. Naming all four is what lets the process that consumes the
  queue compose them.

  The pipeline itself is registered on EVERY install, exactly as the App
  registers it: it is command-only, nothing dispatches into it where no meter
  is composed, and the two graphs share one job queue that redelivers a key
  neither side can route.

  @unit
  Scenario: The monthly roll-up is registered on every install
    Given a background worker composing its own graph
    When the deployment is not SaaS
    Then the roll-up is still mounted
    And no meter is mounted beside it

  @unit
  Scenario: The worker builds the monthly roll-up from its own client
    Given a worker holding one Prisma client and the queue's one Redis
    When a month is reported
    Then the organization read and the checkpoint go through that client
    And the read-through cache goes through that Redis

  @unit
  Scenario: The worker reads a billable organization the way the App reads it
    Given an organization the App would report for
    When the worker asks whether it is billable
    Then it asks for the same pricing model and the same live subscription
    And an organization on another pricing model is nothing to report

  @unit
  Scenario: Both graphs cache the billing organization read in one keyspace
    Given a billing organization read that both graphs make
    When one of them caches the answer
    Then the other reads it back under the same key
    And neither expires the other's entry early

  @unit
  Scenario: An unreachable cache never stops a month being reported
    Given a Redis that refuses every call
    When the roll-up reads and writes its cache
    Then both degrade to the database rather than failing the month

  @unit
  Scenario: The worker reads the month's total by organization, not by tenant
    Given a worker composing the roll-up over its own tenant-keyed ClickHouse client
    When the month's total for a private-instance customer is read
    Then the client is resolved for the organization
    And it is never resolved for the project

  @unit
  Scenario: The worker reports into the meter the App reports into
    Given a composed usage reporter
    When the deployment names its runtime mode
    Then a production process reports into the live meter
    And every other process reports into the test meter

  @unit
  Scenario: A SaaS worker refuses to compose without the credential its reports are sent with
    Given a SaaS worker with no Stripe secret
    When the graph is composed
    Then composition fails the way the application fails
    And a self-hosted worker composes no reporter at all
