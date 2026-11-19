Feature: OCSF 1.9 SIEM export, push and ingest

  A security team reads the organisation's AI activity and admin actions into its SIEM as OCSF
  1.9.0 API Activity events. It pulls them over REST with an organisation API key, or has
  LangWatch push them to a signed webhook endpoint. Each event carries the OCSF 1.9
  AI objects LangWatch knows: `ai_model` (name, provider), `ai_agent` (name, id) and
  `message_context` (token counts), plus the cost under `unmapped.langwatch`. Prompt and response
  text are never exported. The same team can push OCSF events from its other tools into
  LangWatch, where they are stored and exported next to LangWatch's own.

  Three streams are exported, each with its own route and cursor: the governance events
  (governance-ingested traces, pulled provider events, admin workspace views and events pushed
  in), the organisation's project traces, and its audit log. Every page answers a `next_cursor`
  to resume from and `has_more` to say whether to read again at once.
  Docs: docs/ai-gateway/governance/ocsf-export.mdx

  Background:
    Given an Enterprise organisation with an internal governance project and two projects

  Rule: every exported event is an OCSF 1.9.0 API Activity event with the AI fields LangWatch knows

    @unit
    Scenario: A governance trace becomes an OCSF 1.9 event with its AI model, tokens and cost
      Given a governance trace on model "openai/gpt-5-mini" with 120 prompt and 30 completion tokens costing 0.0042 USD
      When it is exported
      Then the event is class 6003 with metadata version "1.9.0" and its LangWatch event id as metadata uid
      And ai_model names "gpt-5-mini" from provider "openai"
      And message_context counts 120 prompt, 30 completion and 150 total tokens
      And unmapped.langwatch carries the cost 0.0042 USD

    @unit
    Scenario: An LLM invocation is exported as activity Other named Invoke
      Given a stored event recorded with the OCSF 1.1 invoke activity 6
      When it is exported
      Then its activity_id is 99 with activity_name "Invoke" and type_uid 600399

    @unit
    Scenario: Prompt and response text never leave in an exported event
      Given a governance trace whose stored payload holds prompt and response text
      When it is exported
      Then the event has no prompt_text and no response_text anywhere

    @unit
    Scenario: A pulled provider event carries its model and tokens into the AI fields
      Given a pulled provider event targeting "claude-sonnet-4" with 900 input and 200 output tokens
      When it is exported
      Then ai_model names "claude-sonnet-4" and message_context counts 1100 total tokens

    @unit
    Scenario: An admin workspace view is exported as a Read of the workspace it opened
      Given an admin viewed the workspace "Payments team"
      When it is exported
      Then its activity_id is 2 and its resources name "Payments team"
      And it has no ai_model

    @unit
    Scenario: A project trace becomes an OCSF event naming its project, model and agent
      Given a project trace on model "anthropic/claude-sonnet-4" by agent "billing-agent" for user "user-7"
      When it is exported
      Then ai_model names "claude-sonnet-4" from provider "anthropic"
      And ai_agent names "billing-agent"
      And actor.user.uid is "user-7" and unmapped.langwatch names the project

    @unit
    Scenario: An audit log entry becomes an OCSF event with its actor, target and outcome
      Given an audit entry "organization.member.remove" by "user-1" on member "user-9" that failed
      When it is exported
      Then its activity_id is 4 with status_id 2
      And actor.user.uid is "user-1" and its resources name the member "user-9"

    @unit
    Scenario: An event pushed in from another source is exported as it was received
      Given an OCSF Authentication event pushed in from source "okta"
      When it is exported
      Then the exported event equals the event as received

  Rule: the export is pulled with an organisation API key holding complianceExport:view

    @integration
    Scenario: A key holding complianceExport:view pages the governance events with a cursor
      Given three governance events
      When a SIEM reads the export two events at a time
      Then the first page holds two events, has_more is true and next_cursor is set
      And the page after next_cursor holds the third event and has_more is false

    @integration
    Scenario: The export filters governance events by time range and source type
      Given governance events from two source types on two days
      When a SIEM reads the export for one source type since the second day
      Then only that source type's events from the second day are returned

    @integration
    Scenario: A key without complianceExport:view is refused
      Given an organisation API key holding only governance:view
      When it reads the export
      Then the answer is 403

    @integration
    Scenario: An organisation off the Enterprise plan is refused the export
      Given the organisation is on the Growth plan
      When a SIEM reads the export
      Then the answer is 402 with code "enterprise_plan_required"

    @integration
    Scenario: A cursor the export did not issue is a validation error
      When a SIEM reads the export with the cursor "not-a-cursor"
      Then the answer is 422 with code "validation_error"

    @integration
    Scenario: The governance events stream pages in write order and reads an event written again once, at its newest version
      Given three governance events stored one after another
      When a SIEM reads them two per page with the cursor
      Then the pages hold the events in the order they were stored
      And an event written again after the cursor is read once more, with its newest payload only

    @integration
    Scenario: The governance events stream filters stored events by source and time
      Given governance events from two source types at different times
      When the stream is read for one source type, one source or one time window
      Then only the events inside that filter are returned

    @integration
    Scenario: The project traces stream walks every project and resumes from its cursor
      Given each of the two projects holds one trace
      When a SIEM reads the project traces stream until has_more is false
      Then it receives both traces as OCSF events
      And the last next_cursor starts the next read where this window ended

    @integration
    Scenario: A later page of the project traces stream reads up to the until it is sent
      Given each of the two projects holds one trace
      When a SIEM reads the first page with one until and the next page with a later until
      Then the next page reads traces up to the later until

    @integration
    Scenario: The next traces window opens where the reads covered, not at a later until
      Given each of the two projects holds one trace
      And every traces read covers updates only up to a moment before the requested until
      When a SIEM reads the project traces stream until has_more is false
      Then the last next_cursor starts the next window at the moment the reads covered
      And no traces read asks for updates later than now

    @integration
    Scenario: A project outside the organisation is refused on the project traces stream
      When a SIEM reads the project traces stream for a project of another organisation
      Then the answer is 422 with code "validation_error"

    @integration
    Scenario: The audit stream lists the organisation's audit entries after a cursor
      Given three audit entries for the organisation
      When a SIEM reads the audit stream two entries at a time
      Then it receives all three entries in order as OCSF events across two pages

    @integration
    Scenario: The audit stream holds back entries younger than ten minutes
      Given an audit entry from yesterday and one written a minute ago
      When a SIEM reads the audit stream
      Then it receives only the entry from yesterday

  Rule: events are pushed to the webhook endpoints that subscribe to ocsf.event

    @integration
    Scenario: An event the api writes reaches a subscribed endpoint once
      Given an active webhook endpoint subscribed to "ocsf.event"
      When the api, which runs no pipeline, writes an admin workspace view event twice
      Then one push intent is queued in Postgres for the worker
      And the worker's handler asks one signed delivery for that endpoint

    @unit
    Scenario: Each written OCSF event is queued for every subscribed endpoint
      Given an active webhook endpoint subscribed to "ocsf.event"
      When three governance events are written
      Then three deliveries are queued for that endpoint, one OCSF 1.9 event each

    @unit
    Scenario: An endpoint subscribed to every event type receives no OCSF events
      Given an active webhook endpoint subscribed to "*"
      When governance events are written
      Then no delivery is queued

    @unit
    Scenario: An event written again keeps its delivery key, so the endpoint receives it once
      Given an active webhook endpoint subscribed to "ocsf.*"
      When a governance event is written, then written again beside a new one
      Then the repeated event carries the same idempotency key both times

    @unit
    Scenario: No event is queued for an organisation off the Enterprise plan
      Given the organisation is on the Growth plan with an endpoint subscribed to "ocsf.event"
      When governance events are written
      Then no delivery is queued

    @unit
    Scenario: Events pushed in from another source are not pushed back out
      Given an active webhook endpoint subscribed to "ocsf.event"
      When OCSF events pushed in from another source are written
      Then no delivery is queued

  Rule: OCSF events from other sources are pushed in with an organisation API key holding governance:manage

    @integration
    Scenario: Ingested OCSF events are stored and read back in the export
      Given an organisation API key holding governance:manage and complianceExport:view
      When it posts two OCSF events from source "okta"
      Then the answer accepts 2 events
      And the export filtered to source type "ocsf_push" returns both events as sent

    @integration
    Scenario: An OCSF event sent twice is stored once
      When the same OCSF event from source "okta" is posted twice
      Then the export returns it once

    @integration
    Scenario: An OCSF event without metadata.uid is refused
      When it posts an OCSF event with no metadata.uid
      Then the answer is 422 with code "validation_error" naming "metadata.uid"

    @integration
    Scenario: A SIEM reading on with its cursor receives an event pushed in with an earlier time
      Given a SIEM read the export and kept its next_cursor
      When an OCSF event whose time is a day earlier is pushed in
      Then the read from that cursor returns the event

    @integration
    Scenario: A push-in body over the bulk body limit is refused with 413
      When a source pushes a 40 MB body to the ingest route
      Then the response is 413

    @integration
    Scenario: An event over 64 KiB of UTF-8 is refused even when it holds fewer characters
      When a source pushes an event of under 65,536 characters but over 64 KiB as UTF-8
      Then the response is 422

    @integration
    Scenario: An event with a class_uid outside the OCSF range is refused
      When a source pushes an event with class_uid 99999999999
      Then the response is 422 naming class_uid

    @integration
    Scenario: An event timed more than a day ahead is refused
      When a source pushes an event whose time is two days from now
      Then the response is 422 naming time

    @integration
    Scenario: An event timed before the year 2000 is refused
      When a source pushes an event whose time is in 1970
      Then the response is 422 naming time

    @integration
    Scenario: A seat report pushed in from another source leaves the seat figures alone
      When a source pushes an event whose api.operation is seat_report
      Then the organisation's seat reports are unchanged

    @integration
    Scenario: Each push-in batch leaves one audit row without the events
      When a source pushes two events in one request
      Then one audit row records the ingest and holds none of the event payloads

    @integration
    Scenario: A key without governance:manage cannot push events in
      Given an organisation API key holding only complianceExport:view
      When it posts an OCSF event
      Then the answer is 403
