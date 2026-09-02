Feature: The standalone API process dispatches commands and consumes none
  As an operator running a LangWatch API deployment
  I want the API process to send Eventing commands over its own queue without
  claiming the shared job queue
  So that a service whose writes are commands can be composed in the API tier
  without a second process racing the worker for its jobs

  # WHY THIS EXISTS
  #
  # `event-sourcing/jobs` is ONE queue holding every pipeline's jobs, and
  # exactly one process may claim it: a claimant that has not registered every
  # pipeline rejects and redelivers the rest, forever. That is why the API
  # process cannot simply build the runtime the worker builds.
  #
  # It does not need to. Producing and consuming are separable — a command's
  # routing key is stamped from the pipeline and command names at send time —
  # so this tier can register the same packaged definitions as a producer and
  # leave every handler, append and fold to the worker.
  #
  # What makes that safe is that the producer-only shape is structural rather
  # than a rule someone has to keep: the seat where a durable event store would
  # go refuses every operation, and there is no process store at all.

  Rule: The runtime exists only where the queue does

    @unit
    Scenario: A process with no queue composes no dispatch
      Given the deployment configured no Redis
      When the process composes its Eventing runtime
      Then it composes none, and names the consequence at boot
      # The queue infrastructure has already named the cause. A reader of the
      # boot log should not have to derive "no dispatch" from "no Redis".

  Rule: A producer owns neither an event log nor a process store

    @unit
    Scenario: The API process's Eventing runtime owns no event log
      Given the API process composed its Eventing runtime
      When something in that process tries to append events
      Then the append is refused and names the process
      # An in-memory store in that seat would accept the append and lose it.

    @unit
    Scenario: The API process's Eventing runtime runs no process managers
      Given the API process composed its Eventing runtime
      When a pipeline declaring a process manager is registered on it
      Then the pipeline registers whole, with its command dispatchers
      And the process manager is declined by name
      And the runtime has no process runtime to ask for
      # An inbox, an outbox and a wake are the consuming process's work, and
      # half of that is a graph that claims work it never drains. Refusing the
      # whole PIPELINE was the wrong half to keep: one declaration inside a
      # definition made every command on it unsendable from the tier a
      # customer's action arrives at, which is how a scenario run and a Langy
      # turn came to answer `service_unavailable` on a healthy deployment.

  Rule: The identity ledgers write through this process's own registrations

    # The two identity ledgers read an absent sender differently and neither
    # reading is "nothing happened": the identity ledger THROWS, because the
    # queued run is what appends its facts, and the join-request ledger throws
    # too. So a pipeline this tier never registered is a write that arrives at
    # the door and cannot leave.

    @integration
    Scenario: A join request command lands on this process's own event stack
      Given the API process registered the identity pipelines producer-only
      When somebody asks to join an organization open to their verified domain
      Then the request's facts are appended before the call returns
      And the join command is staged on the sender the registration produced
      And the join lifecycle process manager is declined by name

    @integration
    Scenario: A process with no queue registers no identity pipeline
      Given the deployment configured no Redis
      When the API process composes its identity pipelines
      Then it registers none, and every ledger refuses by name rather than dropping the write

  Rule: Dispatch is released before the connection under it

    @unit
    Scenario: The runtime is released before the connection under it
      Given the API process composed its Eventing runtime over its Group Queue
      When the process shuts down
      Then the runtime is closed once, before its Redis connection is released
