Feature: Webhook reads emitted spend events through gateway's Api
  Gateway owns gateway_spend and answers every query against it (ADR-134). Webhook's emitted
  events listing and lookup ask gateway for the organization's spend events across its project
  tenants, then render each row as webhook's envelope. Webhook keeps its event vocabulary (the
  type-to-status mapping and the event id); gateway keeps the cursor and the statements.

  @unit
  Scenario: Gateway pages spend events across tenants newest first by status
    Given spend events in two project tenants, in several statuses
    When webhook asks gateway for a page of confirmed and failed events across both tenants
    Then the page holds only those statuses, newest first by occurrence and request id
    And a full page carries a cursor naming its last row

  @unit
  Scenario: A short page ends the walk
    Given fewer matching spend events than the page limit
    When webhook asks gateway for a page
    Then the page carries no cursor

  @unit
  Scenario: Gateway finds one spend event across tenants by request id and status
    Given a spend event in the second of two project tenants
    When webhook looks it up by request id and its event's statuses
    Then gateway answers that row, and nothing for an id it does not hold

  @integration
  Scenario: The webhook events listing answers the same envelopes through gateway
    Given an organization with emitted spend events
    When it lists them over the webhook events door, then reads one by id
    Then the envelopes, their order and the cursor are those the listing answered before
