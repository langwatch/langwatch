Feature: The worker mounts the gateway spend and governance signal pipelines
  Every request the AI Gateway serves is recorded by the gateway spend
  pipeline, and every budget it crosses is reported by the governance signal
  log. The frozen job registry lists seven routing keys for the first and three
  for the second. A worker process that registers fewer does not degrade: the
  queue keeps redelivering the jobs nothing claimed, forever.

  Until now the standalone worker could only re-register definitions the
  application had already built and bound. This feature is about the worker
  building them: its own spend ledger over ClickHouse, its own budget-debit
  process delivering into governance's own commands, and its own ADR-073
  delivery process over the fenced sender it already composes.

  They are ONE composition rather than two, because neither is meaningful
  alone: spend's debits append through governance's commands, and governance's
  delivery process has no producer without spend.

  What a customer notices is only ever the absence: spend that never appears on
  an invoice, a budget crossing nobody was told about, a webhook that never
  arrived.

  Background:
    Given a worker process holding one database, one queue and one ClickHouse client
    And both pipelines composed from packages alone

  Rule: Every routing key the registry lists is claimed

    @unit
    Scenario: The worker mounts every gateway spend and governance routing key
      Given the byte-frozen job registry's seven spend keys and three governance keys
      When the worker builds both pipelines
      Then every key is claimed
      And no key is registered that the registry does not list

  Rule: A capability this process cannot compose is declared, never guessed

    @unit
    Scenario: The settlement sweeper is declared absent, not silently skipped
      Given a worker holding a tenant-keyed ClickHouse resolver and no instance directory
      When it composes the gateway spend pipeline
      Then the settlement absence is reported by name at boot
      And no process manager is mounted that the registry does not name

    @unit
    Scenario: An endpoint secret this deployment encrypted cannot be read without its key
      Given a deployment that named no credentials key
      When the worker composes webhook delivery
      Then the absence is reported by name
      And a deployment that names one stops reporting it

    @unit
    Scenario: The settlement sweeper mounts once the graph can enumerate its endpoints
      Given a worker that opened its own ClickHouse connection
      When it composes the gateway spend pipeline
      Then the settlement sweeper is mounted
      And the settlement absence is no longer reported
      And no routing key is staged for it, because it subscribes to no event

  Rule: A webhook endpoint delivers over the transport it named

    @unit
    Scenario: A webhook endpoint delivers through the packaged transport
      Given an endpoint that delivers over HTTPS
      When the worker dispatches a batch to it
      Then the batch leaves through the process's own fenced sender
      And the delivery is recorded against the delivery id the transport produced

    @unit
    Scenario: An endpoint that delivers to a queue is refused by name without an AWS transport
      Given an endpoint that delivers to a queue
      When the worker dispatches a batch to it and composed no AWS transport
      Then the delivery is refused terminally and the absence is named
      But a worker that owns the process's AWS transport builds the queue transport instead

    @unit
    Scenario: A webhook batch is gated on the plan this deployment resolves
      Given a worker that opened its own database client
      When a batch is about to be delivered for an organization
      Then the organization's own plan decides whether the endpoint is enabled
      And a worker that opened no client refuses the batch and names the absence
        rather than answering a plan it cannot resolve
