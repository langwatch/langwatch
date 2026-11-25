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

  Rule: A webhook endpoint delivers over the transport it named

  Rule: The budget-change signal is an invalidation, not one message per debit

    @unit
    Scenario: Two debits inside one window emit a single budget-updated signal
      Given a project spending against a budget that warns rather than blocks
      When two debits are written inside the same dedupe window
      Then both debits are recorded
      And one budget-updated signal is appended, not one per debit

    @unit
    Scenario: A process with no Redis emits a budget-updated signal for every debit
      Given a worker composed without the queue's Redis
      When two debits are written for the same project
      Then a budget-updated signal is appended for each, because holding an
        invalidation back is never safer than sending it twice
