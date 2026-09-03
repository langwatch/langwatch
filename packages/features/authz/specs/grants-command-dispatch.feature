# See dev/docs/adr/092-authorization-engine.md §13
#
# WHY THIS EXISTS
#
# The grants ledger writes through Eventing commands, and the senders for those
# commands only exist once a runtime has registered the pipeline — which cannot
# happen until the AuthZ service graph that PRODUCES the definition has been
# built. The two ends are unavoidably out of order, and every process that
# composes AuthZ had solved that ordering for itself: its own late-binding
# dispatcher, its own unchecked assertion over the runtime's command map, its
# own copy of the two metric series.
#
# A second composition root made that untenable. What a process legitimately
# owns is its database, its queue and its metric registry; what it must not own
# is a description of when the ledger is writable, what the six commands are
# called, or what the series mean. Those live here now.
#
# The producer/consumer split matters throughout: a process may register the
# grants pipeline and never consume it. Commands still have to reach the shared
# queue under the routing key the CONSUMING process claims, because the
# consumer routes on the names in the definition rather than on who produced
# the job.

@authz
Feature: One description of how grant commands are dispatched
  As the LangWatch platform
  I want every process that composes AuthZ to open its ledger write path the
  same way
  So that a grant change is either durably queued or refused, and never
  silently written down a path the ledger does not know about

  Rule: The ledger write path opens on connection and refuses until it does

    @unit
    Scenario: A connected dispatcher resolves the registration's senders
      Given a registration has connected its command senders
      When the ledger asks for the commands
      Then it receives the senders that registration produced

    @unit
    Scenario: A write that arrives before the registration waits for it
      Given a write asks for the commands before any registration has connected
      When a registration connects
      Then the waiting write receives its senders

    @unit
    Scenario: A registration that never lands refuses rather than falling through
      Given no registration connects within the ledger's wait
      When a write asks for the commands
      Then it is refused as ledger-unavailable
      # Falling through to the imperative write instead would put rows in
      # Postgres that no event records, for an organization whose reads come
      # from the ledger.

    @unit
    Scenario: Two registrations of one pipeline in one process are refused
      Given a registration has connected its command senders
      When a different set of senders is connected in the same process
      Then the second connection is refused
      And connecting the same senders again changes nothing

  Rule: What a registration handed back is checked, not asserted

    @unit
    Scenario: An incomplete registration is refused where it is narrowed
      Given a registration that produced no sender for one of the six commands
      When the ledger's senders are narrowed from it
      Then the narrowing is refused and names the missing command
      # An unchecked assertion here surfaces as "undefined.send is not a
      # function" on the first grant a customer changes.

    @unit
    Scenario: A complete registration forwards every command it names
      Given a registration that produced all six command senders
      When each of the ledger's commands is sent
      Then each one reaches the sender the registration produced for it

  Rule: A process that only produces still routes to the consumer

    @unit
    Scenario: The packaged definition registers without a consumer
      Given a runtime with no consumer and no event log
      When the packaged grants pipeline is registered
      Then a real pipeline is registered rather than one that drops commands
      And its six command senders are all present

    @unit
    Scenario: A produced command carries the consuming process's routing key
      Given a producer-only registration of the packaged grants pipeline
      When each of the six commands is sent with a valid payload
      Then each job carries the pipeline and command names the consumer routes on
      # Where a command was produced is not a fact the consumer needs, and this
      # is what makes that true.

  Rule: Both AuthZ series are described once for every process

    @unit
    Scenario: The two AuthZ series are described once for every process
      Given a process registry
      When AuthZ's counters are resolved against it
      Then the queue-bypassing write counter and the engine-gate read failure
      counter render into that registry
      And the cause of a bypassing write is a label rather than a second series

    @unit
    Scenario: A second composition shares the series rather than refusing
      Given a process that composes AuthZ twice over one registry
      When the second composition resolves its counters
      Then it shares the series the first one created
      # A registry refuses a metric it already holds, so constructing rather
      # than resolving would fail the second composition at boot.

    @unit
    Scenario: A queue-bypassing write is counted under its own cause
      Given a revocation applies its deny effect straight to the projection
      When the write is recorded
      Then it is counted under its own cause and not under the other one
