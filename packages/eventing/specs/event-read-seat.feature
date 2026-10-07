# WHY THIS EXISTS
#
# The api serves trace reads whose large fields were offloaded into the event
# log, so it has to answer one event by id. Its event store seat refuses every
# read by design (producer-only-event-store.feature), and that rule stands
# (Q209, 2026-10-06). So the single-event read is a separate, narrow seat
# beside the store: one event, inside its tenant's aggregate stream, inside
# main's two-day window around the time its KSUID carries.

@event-sourcing
Feature: One event is read by id through a narrow seat beside the event store
  As a LangWatch process that serves reads but appends nothing
  I want to read one event of a tenant's stream by its id
  So that an offloaded value can be recalled without the process owning an event log

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

  Rule: A producer composes the seat beside its refusing store

    @integration
    Scenario: The API process answers one event through its read seat
      Given the API process composed its Eventing runtime with a read seat over the event log
      When something in that process asks the seat for an event the log holds
      Then the event is answered
      And the process's event store still refuses every read by name
