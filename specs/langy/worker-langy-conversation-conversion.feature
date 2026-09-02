Feature: The worker mounts the Langy conversation pipeline
  Every Langy turn a customer takes is folded by the langy conversation
  pipeline, and the frozen job registry lists twenty-four routing keys for it.
  A worker process that registers fewer does not degrade: the queue keeps
  redelivering the jobs nothing claimed, forever.

  Until now the standalone worker could only re-register a definition the
  application had already built and bound. This feature is about the worker
  building it: its own two Postgres folds, its own message and analytics
  projections, its own turn process manager and its own three live
  subscribers, from a database, a Redis connection and a ClickHouse client.

  What a customer notices is only ever the absence: a conversation that stops
  updating in an open tab, a turn that hangs because nothing dispatched it, a
  conversation that never gets a name.

  Background:
    Given a worker process holding one database, one queue and one ClickHouse client
    And the langy conversation pipeline composed from packages alone

  Rule: Every routing key the registry lists is claimed

    @unit
    Scenario: The worker mounts every langy conversation routing key
      Given the byte-frozen job registry's twenty-four langy conversation keys
      When the worker builds its langy conversation pipeline
      Then every key is claimed
      And no key is registered that the registry does not list
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
    Scenario: A worker without an agent manager says so at boot
      Given a deployment that named no agent manager
      When the worker composes the langy conversation pipeline
      Then the absence is reported by name
      And a deployment that named only half the pair is refused

    @unit
    Scenario: Title generation and session-key minting are declared absent
      Given a worker that composes no model provider and no authorization graph
      When it composes the langy conversation pipeline
      Then both absences are reported by name at boot
