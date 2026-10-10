# WHY THIS EXISTS
#
# The api serves trace reads whose large fields were offloaded into the event
# log, so it has to answer one event by id. Its event store seat refuses every
# read by design (producer-only-event-store.feature), and that rule stands
# (Q209, 2026-10-06). So the single-event read is a separate, narrow seat
# beside the store: one event, inside its tenant's aggregate stream, inside
# main's two-day window around the time its KSUID carries.
#
# The api also serves a module's own aggregate history (an SSO connection's
# event log card), which is the log itself and has no projection to read. The
# seat answers that too: one aggregate's stream, named by its whole key inside
# one tenant. It appends nothing, and the store beside it still refuses.

@event-sourcing
Feature: Events are read through a narrow seat beside the event store
  As a LangWatch process that serves reads but appends nothing
  I want to read one event, or one aggregate's stream, of a tenant
  So that an offloaded value or an aggregate's history can be recalled without
  the process owning an event log

  Rule: The seat answers one event of one tenant's stream, inside the window

    @unit
    Scenario: An event inside the window is answered
      Given an event whose recorded time is within two days of the time its id carries
      When the seat is asked for that event by tenant, stream and id
      Then that event is answered, with its data

    @unit
    Scenario: An event recorded outside the window is not found
      Given an event whose recorded time is more than two days from the time its id carries
      When the seat is asked for that event
      Then the read fails as not found

    @unit
    Scenario: An event with no recorded time is always answered
      Given an event stored with no occurred time
      When the seat is asked for that event
      Then that event is answered, because the window can never hide a present row

    @unit
    Scenario: An id that carries no time is read without a window
      Given an event whose id is not a KSUID
      When the seat is asked for that event
      Then that event is answered without a time bound on the read

    @unit
    Scenario: Another tenant's event is never answered
      Given an event in one tenant's stream
      When another tenant asks the seat for it by the same stream and id
      Then the read fails as not found

    @unit
    Scenario: A read without an event id or stream is refused
      When the seat is asked for an event with an empty id or an empty aggregate id
      Then the read is refused as invalid before anything is queried

    @unit
    Scenario: The event log read is bounded to two days either side of the id's time
      Given the seat composed over the ClickHouse event log
      When it is asked for an event whose id is a KSUID
      Then the statement names the tenant first and the whole stream key
      And it keeps rows with no occurred time and rows within two days either side of the id's time

  Rule: The seat answers one aggregate's stream of one tenant

    @unit
    Scenario: An aggregate's events are answered oldest first
      Given an aggregate holding three events in one tenant's stream
      When the seat is asked for that aggregate's events by tenant and stream
      Then the three events are answered oldest first, with their data

    @unit
    Scenario: An aggregate nothing happened to answers no events
      Given a tenant whose stream holds no event for an aggregate
      When the seat is asked for that aggregate's events
      Then no events are answered, and the read does not fail

    @unit
    Scenario: Another tenant's stream is never answered
      Given an aggregate holding events in one tenant's stream
      When another tenant asks the seat for the same aggregate type and id
      Then no events are answered

    @unit
    Scenario: Another aggregate type under the same id is never answered
      Given two aggregate types holding events under the same tenant and aggregate id
      When the seat is asked for one aggregate type's events
      Then none of the other aggregate type's events are answered

    @unit
    Scenario: A stream read without an aggregate id is refused
      When the seat is asked for the events of an empty aggregate id
      Then the read is refused as invalid before anything is queried

    @unit
    Scenario: The event log stream read names the tenant first and the whole stream key
      Given the seat composed over the ClickHouse event log
      When it is asked for one aggregate's events
      Then the statement names the tenant first, then the aggregate type and id
      And it reads no other tenant's rows

  Rule: A producer composes the seat beside its refusing store

    @integration
    Scenario: The API process answers one event through its read seat
      Given the API process composed its Eventing runtime with a read seat over the event log
      When something in that process asks the seat for an event the log holds
      Then the event is answered
      And the process's event store still refuses every read by name

    @integration
    Scenario: The API process answers one aggregate's events through its read seat
      Given the API process composed its Eventing runtime with a read seat over the event log
      When something in that process asks the seat for an aggregate's events the log holds
      Then those events are answered
      And the process's event store still refuses every read by name
