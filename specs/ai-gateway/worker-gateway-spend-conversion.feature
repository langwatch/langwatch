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
