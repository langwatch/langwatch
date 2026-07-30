@unit
Feature: A pipeline is one chain
  Everything a pipeline is — its vocabulary, its identity, its members, and the
  infrastructure each member writes to — is stated once, in one file: a name,
  an optional prefix, an event vocabulary, an optional aggregate id, then any
  number of commands, folds, maps, process managers and subscribers, then
  `.build()`. Nothing about it is restated anywhere else. (ADR-105.)

  Background:
    Given a pipeline is being declared

  Rule: An event is its payload schema, and nothing else

    Scenario: the persisted type string derives from the pipeline name and the event key
      Given a pipeline named "trace" declaring an event "spanReceived"
      When the pipeline is built
      Then the event's persisted type is "trace/spanReceived"

    Scenario: a prefix produces the legacy dotted, snake-cased form
      Given a pipeline named "trace" with prefix "lw.obs" declaring an event "spanReceived"
      When the pipeline is built
      Then the event's persisted type is "lw.obs.trace.span_received"

    Scenario: an event's membership in the router's filter set derives from the vocabulary alone
      Given a pipeline declaring two events
      When the pipeline is built
      Then the built pipeline's event types list both, and nothing else

    Scenario: declaring no events at all is refused
      Given a pipeline declared with an empty event map
      Then the declaration is refused

    Scenario: an event key containing the type-string separator is refused
      Given a pipeline declaring an event key that contains "/" or "."
      Then the declaration is refused

    Scenario: an event key containing an underscore is refused
      Given a pipeline declaring an event key that already contains "_"
      Then the declaration is refused
      # CamelToSnake inserts its own separators, so a key carrying one already
      # derives a different string in the types than at runtime

  Rule: .id is offered exactly when a member needs it, and is exhaustive over the events

    Scenario: a pipeline of maps and commands alone is never asked for an id
      Given a pipeline that declares only commands and maps
      Then no step in the chain asks for an id

    Scenario: a fold is only reachable after .id has fixed the aggregate identity
      Given a pipeline that has not called .id
      Then the chain offers no way to mount a fold

    Scenario: a process manager is only reachable after .id has fixed the aggregate identity
      Given a pipeline that has not called .id
      Then the chain offers no way to mount a process manager

    Scenario: the id map supplies one extractor per declared event
      Given a pipeline declaring three events and an id map naming an extractor for each
      When an event's id is resolved
      Then the extractor declared for that event's own key is the one that ran

  Rule: Handlers are keyed by event, never switched over event

    Scenario: a fold's handler receives only the payload its own event key carries
      Given a fold naming a handler for one event key
      When that event is delivered
      Then the handler receives that event's own payload, typed to its own schema

    Scenario: an event with no declared fold handler leaves the state unchanged
      Given a fold that names a handler for only one of the pipeline's events
      When an event it did not name is delivered
      Then the fold's state is returned unchanged

    Scenario: an event with no declared map handler produces no row
      Given a map that names a handler for only one of the pipeline's events
      When an event it did not name is delivered
      Then no row is written

    Scenario: an event with no declared subscriber handler runs nothing
      Given a subscriber that names a handler for only one of the pipeline's events
      When an event it did not name is delivered
      Then nothing runs

    Scenario: an event with no declared process-manager handler runs no step at all
      Given a process manager that names a handler for only one of the pipeline's events
      When an event it did not name is delivered
      Then no step runs, and nothing about state or the armed wake changes

    Scenario: a member built with no handlers at all is refused
      Given a fold, a map, a subscriber and a process manager each declared with an empty handler map
      Then each declaration is refused

  Rule: Only the members that reach outside a pipeline get a context

    Scenario: a fold handler receives no context
      Given a fold's handler function
      Then its parameters are exactly the state and the event's payload

    Scenario: a map handler receives no context
      Given a map's handler function
      Then its only parameter is the event's payload

    Scenario: a command handler reaches its collaborator through the closure it was mounted with
      Given a command whose handler was mounted closing over a collaborator
      When the command is handled with the runtime context
      Then the handler reached that exact collaborator instance
      And the handler received the runtime context it was handled with

    Scenario: a process-manager handler additionally knows which instance it is running for
      Given a process manager's event handler
      When an event is delivered to the process manager with the runtime context
      Then the handler received that context including its process key

    Scenario: a subscriber handler receives the payload and the runtime context
      Given a subscriber's handler function
      When an event is delivered to the subscriber with the runtime context
      Then the handler received the event's payload and that same runtime context

  Rule: A command is the trust boundary, and its only output is events

    Scenario: a command's handler emits events named by their own vocabulary key
      Given a command that emits one declared event from its input
      When the command is handled
      Then the emitted event carries the pipeline's derived persisted type, not the bare key

    Scenario: a command may emit more than one event
      Given a command whose handler emits two different declared events
      When the command is handled
      Then both emitted events carry their own derived persisted types

    Scenario: a command may emit no events at all
      Given a command whose handler decides nothing needs to happen
      When the command is handled
      Then no events are emitted

  Rule: An intent declares its payload, its key and its delivery together

    Scenario: an intent's type is qualified by the process manager that declared it
      Given a process manager named "settlement" declaring an intent "notifyDigest"
      When the pipeline is built
      Then the intent's derived type is "settlement/notifyDigest"

    Scenario: messageKey computes the same key for a retried intent carrying the same payload
      Given a process manager whose intent derives its key from its payload alone
      When the same payload is used to compute the key twice
      Then both computations produce the identical key

    Scenario: delivering an intent reaches the collaborator closed over at the mount
      Given a process manager whose intent's delivery was mounted closing over a collaborator
      When that intent is delivered
      Then the delivery reached that exact collaborator instance

    Scenario: a process manager declaring no intents at all is refused
      Given a process manager declared with an empty intents map
      Then the declaration is refused

  Rule: A process manager arms and clears its own wake, and may be gated off

    Scenario: a step arms a wake by returning the instant it is next due
      Given a process manager whose handler returns a future instant as the next wake
      When an event is delivered
      Then the resulting step reports that instant as the next wake

    Scenario: a step clears a wake by returning null
      Given a process manager whose handler returns null as the next wake
      When an event is delivered
      Then the resulting step reports no wake armed

    Scenario: a process manager is enabled by default
      Given a process manager declared without calling .enabled
      When the pipeline is built
      Then the process manager reports itself enabled

    Scenario: a process manager can be gated off explicitly
      Given a process manager declared with .enabled(false)
      When the pipeline is built
      Then the process manager reports itself disabled

  Rule: A fold's version is the hash of its own state schema

    Scenario: two folds with the same state shape derive the same version
      Given two folds declared with structurally identical state schemas
      When each pipeline is built
      Then both folds report the identical derived version

    Scenario: changing a fold's state schema changes its derived version
      Given a fold whose state schema gains a field
      When the pipeline is built
      Then the derived version differs from the version before the field was added

    Scenario: an explicit pin overrides the derived version without switching off the hash
      Given a fold declared with an explicit version pin
      When the pipeline is built
      Then the fold's reported version is the pin
      And the fold's reported schema hash is still the value the shape derives

  Rule: Handlers return new state

    Scenario: a fold's handler returns a new state object rather than mutating the one it was given
      Given a fold's handler that builds its next state from the state it was given
      When an event is applied
      Then the state object handed to the handler is left untouched

  Rule: A member's name is its identity, and it cannot be reused

    Scenario: two members sharing a name is refused
      Given a pipeline that mounts two members under the identical name
      Then the second mount is refused

  Rule: A pipeline's own identity cannot produce an unroutable type string

    Scenario: a pipeline name containing the type-string separator is refused
      Given a pipeline declared with a name containing "/" or "."
      Then the declaration is refused

    Scenario: a pipeline prefix containing the unprefixed-form separator is refused
      Given a pipeline declaring a prefix that contains "/"
      Then the declaration is refused

    Scenario: an intent key containing the type-string separator is refused
      Given a process manager declaring an intent key that contains "/" or "."
      Then the declaration is refused

  Rule: A process manager cannot be mounted before the pipeline has an id

    Scenario: mounting a process manager without a preceding .id is refused
      Given a pipeline chain that has not called .id
      When a process manager is force-mounted onto it
      Then the mount is refused
