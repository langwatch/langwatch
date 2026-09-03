# The tracked-event endpoints validate in two passes: a base schema every
# event must satisfy, then — for the predefined event types — the schema for
# that specific type. Both passes must answer the caller the same way.

Feature: Tracked-event validation answers the caller
  As a customer posting a tracked event
  I want a rejected payload to say which field was wrong
  So that I can fix the call instead of guessing at a server error

  Context: `predefinedEvents.schema.ts` is authored against `zod/v4` while the
  base schema is authored against the default (v3) export, and the formatter
  both routes used — `fromZodError` from zod-validation-error@3 — understands
  only the v3 error. Handed a v4 error it read `.errors`, which does not exist
  there, and threw `TypeError: Cannot read properties of undefined (reading
  'length')`. That throw escaped the very `catch` block whose job was to turn a
  validation failure into a 400, so a malformed `thumbs_up_down` was answered
  with a 500 and no indication of the offending field. The same two-line
  pattern appears in both tracked-event routes, so both were affected.

  Background:
    Given a customer posts to the tracked-event endpoint with a valid API key

  @unit
  Scenario: A rejected predefined event names the offending field
    Given a "thumbs_up_down" event whose vote is outside the allowed range
    When the payload is validated
    Then the validation message names the "metrics.vote" field

  @unit
  Scenario: Formatting a validation failure never throws
    Given a validation error raised by either zod entrypoint
    When the message is formatted for the caller
    Then a message is produced rather than an exception

  @unit
  Scenario: A non-validation error is still formatted as a message
    Given the failure handed to the formatter is not a validation error at all
    When the message is formatted for the caller
    Then a message is produced rather than an exception

  @unit
  Scenario: A base-schema rejection keeps the wording it already had
    Given a payload missing a field the base schema requires
    When the message is formatted for the caller
    Then the message names the missing field

  @integration
  Scenario: A predefined event that violates its schema is rejected, not errored
    Given a "thumbs_up_down" event whose vote is outside the allowed range
    When the customer posts it
    Then the response status is 400
    And the response names the "vote" field
    And the event is not recorded

  # The endpoint has two URLs. `POST /api/track_event` predates
  # `POST /api/events/track` and every pre-rename SDK release still posts to
  # it, so the pair has to stay one endpoint: the legacy URL replays the
  # request against the canonical route rather than being a second handler,
  # because two handlers over one recorder drift the first time one of them
  # gains a check the other does not.

  @integration
  Scenario: The legacy URL reaches the same recorder as the canonical one
    Given a valid "thumbs_up_down" event carrying the caller's own event id
    When the customer posts it to the legacy tracked-event URL
    Then the event is recorded with the id the caller supplied
    And the response is the same confirmation the canonical URL answers

  @integration
  Scenario: A rejected event is rejected the same way on both URLs
    Given a "thumbs_up_down" event whose vote is outside the allowed range
    When the customer posts it to either tracked-event URL
    Then the response status is 400
    And the response names the "vote" field
    And the event is not recorded

  @integration
  Scenario: Neither URL is served without a recorder to send the event to
    Given a process that registered no trace command queue
    When the mounted paths are enumerated
    Then neither tracked-event URL is served
