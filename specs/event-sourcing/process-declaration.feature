@unit
Feature: A process manager is one declaration, the same way an aggregate is
  A process manager is durable, at-least-once work with a stake: money, an
  outbound message, or a state transition a customer can see (ADR-098). Its
  one pure step is evolve(previousState, input) -> { state, nextWakeAt,
  intents }, and everything nameable about it is derived from one
  declaration the same way an aggregate's is — the intent type string, the
  payload type, the intent union, and the typed creators that build one.

  Before this declaration existed, an intent's type string was written
  twice: once as a map key inside the process, and again as a hand-maintained
  constant asserted to agree with it. A message key was hand-typed at the
  call site too, sometimes from the wall clock and sometimes from a value
  the process computed but never declared in the intent's own payload — both
  shapes double-send an intent on retry, because the same logical intent
  computes a different key the second time. (ADR-105 amendment.)

  A process's wake is one of two kinds, modelled as a discriminated variant
  rather than an optional field two conventions shared: an evolve-driven
  process computes its own deadline on every step, so its result always
  states what happens to the wake, even to clear it. A fixed-interval
  process has no deadline to compute, so its result carries no wake field at
  all, and the runtime re-arms it from the declared interval instead.

  Background:
    Given a process manager is being declared

  Scenario: derives a type string per intent, qualified by the process
    Given a process that declares one intent
    When the process is built
    Then its declared intent type is the process name and the intent's key, joined the same way an event type is

  Scenario: creates an intent carrying the derived type, the declared payload, and a message key computed from that payload
    Given a built process with a declared intent
    When a call site creates that intent from a payload
    Then the created intent carries the derived type string, the given payload, and a message key computed from that payload alone

  Scenario: computes the same message key for a retried intent with the same payload
    Given a built process with a declared intent
    When the same payload creates that intent twice
    Then both intents carry the identical message key

  Scenario: subscribes to exactly the event types its declared aggregate produces
    Given a process declared against one aggregate's events
    When the process is built
    Then its subscribed event types are exactly the aggregate's own declared event types

  Scenario: narrows the incoming event by its declared type inside evolve
    Given a process declared against an aggregate with more than one event
    When evolve receives one of that aggregate's events
    Then the event narrows to the payload that event's own type carries

  Scenario: arms a wake by returning the instant it is next due
    Given an evolve-driven process
    When its step returns a future instant as the next wake
    Then the built process reports that instant as the next wake

  Scenario: clears a wake by returning null
    Given an evolve-driven process
    When its step returns null as the next wake
    Then the built process reports no wake is armed

  Scenario: carries no wake instant of its own in its step result
    Given a fixed-interval process
    When its wake fires
    Then the step result has no next-wake field at all, because the interval already fixed it

  Scenario: refuses a schedule that is not a positive, finite number of milliseconds
    Given a process being declared with a fixed interval
    When the declared interval is zero or infinite
    Then the declaration is refused

  Scenario: refuses a process name containing the event-type separator
    Given a process name that contains the separator used to qualify a type string
    When the process is declared
    Then the declaration is refused

  Scenario: refuses an intent key containing the event-type separator
    Given an intent key that contains the separator used to qualify a type string
    When the process is declared
    Then the declaration is refused

  Scenario: refuses a process that declares no intents
    Given a process that declares no intents at all
    When the process is declared
    Then the declaration is refused

  Scenario: reports an intent type that disappears between snapshots, the same way an event type is
    Given a committed snapshot of a process's intent types
    When the process's current declaration no longer includes one of them
    Then the ratchet reports the missing intent type under that process

  Scenario: places one lane per process instance, scoped by the process's own name and the caller's process key
    Given a built process and a caller-supplied process key
    When the process's group key is derived
    Then the lane names the process and the scope names one instance of it

  Scenario: round-trips through the renderer back to the same descriptor
    Given a process's derived group key
    When it is rendered and then parsed back
    Then the parsed result is the same descriptor
