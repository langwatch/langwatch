Feature: Transient process evolutions cost no durable row

  A process manager mounted on a pipeline is keyed by that pipeline's
  aggregate. When the aggregate is an entity — a conversation, a scenario run,
  a webhook endpoint — a durable row per key is exactly right. When the
  aggregate is a unit of TRAFFIC, as the gateway spend pipeline's is (one
  aggregate per gateway request), the same rule mints a permanent row per LLM
  call in a table that process-manager-retention.feature deliberately does not
  sweep.

  The fix is not to sweep harder. It is to notice that some evolutions leave
  nothing behind worth reading back: they keep the initial state and arm no
  wake, so their only output is their intents. Those commit the intents alone.

  # WHY THE TRANSACTION CAN GO. `commit` is transactional because it writes an
  # inbox marker AND outbox messages, and one interleaving is damaging: a
  # marker without its messages says the event was consumed while nothing was
  # enqueued, which is silent loss. The other order is harmless — messages
  # without a marker are redelivered, re-derive the same keys, and are
  # suppressed by the outbox's own uniqueness.
  #
  # An evolution that keeps no state has nothing to lose between two writes.
  # Its outbox key is already a pure function of the event, so that uniqueness
  # IS the consumption record and a second marker for the same fact buys
  # nothing. What remains is a set of idempotent inserts, correct under crash,
  # redelivery, and two workers racing the same event, with no lock, no
  # compare-and-swap and no transaction.
  #
  # THE CONTRACT THAT REPLACES IT: every message key a transient evolution
  # mints must be derivable from the event alone. A key built from a clock or
  # a random value cannot be re-derived by a redelivery, so the suppression
  # misses and the side effect happens twice.

  Rule: An evolution that keeps nothing writes no process instance

    @unit
    Scenario: A transient evolution writes its intents and no process instance
      Given a process manager declared transient
      When an event evolves to the initial state with no wake armed
      Then the intent is enqueued
      And no process instance row exists for that key

    @unit
    Scenario: An evolution with nothing to say writes nothing at all
      Given a process manager declared transient
      When an event evolves to the initial state and mints no intent
      Then no process instance row exists for that key
      And no outbox message exists for that key

    @unit
    Scenario: A process manager may be transient for one key and durable for another
      Given a process manager declared transient
      When an event evolves to a state that differs from the initial state
      Then a process instance row is committed for that key with its revision

  Rule: Idempotency moves to the outbox rather than being lost

    @unit
    Scenario: A redelivered event re-derives the same key and enqueues nothing new
      Given a transient evolution already enqueued its intent
      When the same event is delivered again
      Then the message key is reported as a duplicate
      And exactly one outbox message exists for that key

    @unit
    Scenario: The durable path keeps its inbox marker, so a redelivery is a no-op
      Given a durable evolution already committed for a key
      When the same event is delivered again
      Then the commit reports a duplicate event

    @unit
    Scenario: A transient process mints message keys that a redelivery re-derives exactly
      Given a transient process manager on the gateway spend pipeline
      When the same event is handled at two different wall clocks
      Then both handlings mint identical message keys

  Rule: A transient process cannot be scheduled

    # A schedule is armed by writing a wake onto the instance row a transient
    # evolution declines to write, so a scheduled transient process would have
    # nowhere to be armed and would silently never run.
    @unit
    Scenario: A transient process cannot be scheduled
      Given a process manager declared transient
      When it also declares a schedule
      Then building it fails
