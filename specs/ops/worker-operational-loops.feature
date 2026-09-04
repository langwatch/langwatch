Feature: The worker runs the operational loops nobody else can
  Three loops react to the passage of time rather than to an event: the
  per-tenant enqueue-rate tick behind the Ops page's runaway-tenant view, the
  anonymous daily usage report a self-hosted install sends about itself, and
  the ClickHouse storage collection every table-size, disk-capacity and backup
  alert is built on.

  No routing key can carry any of them, so no queue can redeliver one, and a
  process that never starts them looks exactly like a healthy one. The symptom
  is always an absence: a runaway tenant nobody surfaces, an install nobody
  counts, and an alert with no series — which reads as quiet rather than as
  unreported.

  Background:
    Given a worker process holding its Postgres client, the queue's Redis and
      every configured ClickHouse endpoint

  Rule: The loops are started, and stopped

    @unit
    Scenario: The worker starts all three loops when it boots
      Given a deployment that opted out of nothing
      When the ops feature installer runs
      Then the enqueue-rate tick, the usage report and the storage collection are all running

    @unit
    Scenario: Shutting the worker down stops every loop it started
      Given the ops feature installer has run
      When the worker closes
      Then no timer it started is left running

  Rule: A loop a deployment turned off is off, and one it cannot compose is named

    @unit
    Scenario: The hosted product sends no self-hosted usage report
      Given a deployment that is the hosted product
      When the ops feature installer runs
      Then the usage report does not start
      And the other two loops still run

    @unit
    Scenario: An operator's opt-out stops the usage report
      Given a deployment whose operator disabled usage statistics
      When the ops feature installer runs
      Then the usage report does not start

    @unit
    Scenario: A worker with no queue Redis names the anomaly tick it cannot run
      Given a worker composed without the queue's Redis
      When it composes the operational loops
      Then the enqueue-rate tick is reported absent by name

  Rule: Storage collection reports what the endpoint holds now, not what it held

    @unit
    Scenario: Every monitored table is reported with its endpoint
      Given an endpoint holding rows in two monitored tables
      When the collection ticks
      Then each table's rows, bytes and parts are recorded against that endpoint

    @unit
    Scenario: A table that has dropped to nothing stops being reported
      Given a table reported on the previous tick
      When the next tick no longer finds it
      Then it is no longer reported, rather than held at its last size

    @unit
    Scenario: An unreachable endpoint does not take the others with it
      Given two configured endpoints, one of which refuses the read
      When the collection ticks
      Then the reachable endpoint is still reported
