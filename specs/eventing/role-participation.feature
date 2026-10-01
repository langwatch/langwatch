Feature: A process installs the half of a pipeline its role runs
  As an operator running a LangWatch deployment
  I want each process to install the half of every module's pipeline its role
  runs, without any main saying which half that is
  So that the worker actually drains what the api stages, and neither of them
  can be configured into a shape where both or neither claim the queue

  # WHY THIS EXISTS
  #
  # A module declares its pipeline once — events, commands, projections,
  # subscribers, process managers — and ARCHITECTURE section 9 rules that boot
  # translates that one declaration per role: the api sends, the worker folds,
  # subscribes and owns the process managers.
  #
  # That translation used to need the eventing runtime to announce which half
  # it was, and nothing announced it, so every declaration was installed by
  # nobody at all. The worker booted, reported healthy, claimed its queue and
  # consumed nothing — the one failure mode an operator cannot see, because a
  # process that registered no pipeline looks exactly like one with no work.
  #
  # So participation is derived from the role, which the process already knows
  # and cannot forget to state. A member that states its own still wins, for
  # the process whose shape is deliberately not its role's.

  Rule: The role decides which half, and no main states it

    @unit
    Scenario: The role decides which half a process installs
      Given a module that declares its event sourcing
      And an eventing runtime that states no participation of its own
      When the worker installs the module
      Then the declaration is built to consume
      And the same declaration installed by the api is built to produce

    @integration
    Scenario: A process that states its own participation overrides the role
      Given a process whose eventing member states that it consumes
      When that process installs a module's declaration under the api role
      Then the declaration is built to consume
      # The escape hatch for a deployment whose shape is not its role's. It is
      # stated on the member, where the store and queue underneath it are
      # chosen, so the two can never disagree.

  Rule: What the producer stages, the consumer runs

    @integration
    Scenario: A command sent by the producing process is handled by the consuming one
      Given an api process and a worker process installing one module declaration
      And both are wired to the same event log and the same job queue
      When the api sends a command on the pipeline
      And the worker drains the queue
      Then the worker's process manager holds the state that command produced
      And the event was appended exactly once, by the process that drained it

    @integration
    Scenario: The producing process constructs no reaction
      Given an api process installing a module declaration with a process manager
      When it installs the declaration
      Then it is handed no process state to build against
      And it names the process manager it will not run
      And asking it for a process runtime is refused by name
      # Structural, not a flag: the producer builds no inbox, no outbox and no
      # wake, so there is nothing for a second process to drive.
