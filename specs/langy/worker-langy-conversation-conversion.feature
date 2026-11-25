Feature: The worker mounts the Langy conversation pipeline
  Every Langy turn a customer takes is folded by the langy conversation
  pipeline. A worker process that registers fewer of its routing keys than the
  pipeline declares does not degrade: the queue keeps redelivering the jobs
  nothing claimed, forever.

  The worker boots the langy module in the worker role, and the module builds
  its folds, projections, turn process manager and subscribers from the stores
  it is given.

  What a customer notices is only ever the absence: a conversation that stops
  updating in an open tab, a turn that hangs because nothing dispatched it, a
  conversation that never gets a name.

  Background:
    Given a worker process holding one database, one queue and one ClickHouse client
    And the langy conversation pipeline installed by the langy module

  Rule: Every routing key the registry lists is claimed

    @unit
    Scenario: The worker claims every routing key the langy conversation pipeline declares
      Given the pipeline's declared commands and projections
      When the worker boots
      Then every declared key is claimed
      And the pipeline is named the way the queue routes it

  Rule: Analytics stay content-free and land on the tenant's own cluster

    @unit
    Scenario: Langy analytics rows land on this process's own ClickHouse
      Given a recorded message on a project
      When the analytics projection appends its row
      Then the row is written to the langy analytics table
      And each column carries the name the table declares
      And the row is stamped with this deployment's own retention

  Rule: A capability this process cannot compose is declared, never guessed

    @unit
    Scenario: A deployment without an agent manager runs without one, and half the pair is refused
      Given a deployment that named no agent manager
      When langy reads its configuration
      Then the configuration is accepted
      And a deployment that named only half the pair is refused naming both variables

    # Alex 2026-10-06: never built. The module composes its model provider and
    # authorization peers always, so no absence is reported at boot.
    @unit @unimplemented
    Scenario: Title generation and session-key minting are declared absent
      Given a worker that composes no model provider and no authorization graph
      When it composes the langy conversation pipeline
      Then both absences are reported by name at boot

  Rule: The dispatch outcomes an operator watches Langy by are published

    @unit
    Scenario: The worker publishes the Langy dispatch series
      Given the agent manager answers a dispatch
      When the worker port dispatches a turn
      Then the dispatch is counted on the published series under its outcome
