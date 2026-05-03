Feature: Microsoft Copilot Studio reference puller (built on HttpPollingPullerAdapter)
  As a platform engineer who needs Copilot Studio audit-log ingestion working
  end-to-end without writing a custom adapter
  I want a reference implementation that uses HttpPollingPullerAdapter + a
  fixed config shape per Microsoft's audit-log API
  So that admins enable "Copilot Studio" with one click in the UI + the
  framework handles polling / pagination / event-mapping

  Demonstrates the framework end-to-end. Spec maps to Phase 10 backend
  (Sergey: P10-reference-impl).

  Background:
    Given the puller framework + HttpPollingPullerAdapter + S3PollingPullerAdapter are in place

  Scenario: Admin enables Copilot Studio with one click
    Given alice is an org ADMIN
    When alice clicks "Add ingestion source" → "Microsoft Copilot Studio" → enters her tenant credentials → Save
    Then a new IngestionSource row lands with `sourceType = "copilot_studio"` + `pullConfig = <auto-populated reference config>` + `pullSchedule = "*/15 * * * *"` (15 min default)
    And the BullMQ worker picks up the first scheduled run within ~15 min

  Scenario: Reference config is locked + auditable
    Given the copilot_studio reference puller exists at `langwatch/ee/governance/services/pullers/copilotStudio.puller.ts`
    Then it exports a constant `COPILOT_STUDIO_PULL_CONFIG` defining: URL (Microsoft's audit-log endpoint), authMode ("oauth2_microsoft"), cursorJsonPath, eventsJsonPath, eventMapping per Microsoft's response shape
    And admins cannot override the URL / auth shape (only credentials) — the reference impl is the trusted shape

  Scenario: Reference puller end-to-end against fixture
    Given a fixture HTTP server returns Microsoft's documented response shape with 5 audit events
    When the worker fires the copilot_studio puller against the fixture
    Then 5 normalized events land in the trace store
    And each event carries `langwatch.origin.kind = "ingestion_source"` + `langwatch.origin.source_type = "copilot_studio"`
    And the cursor advances to Microsoft's `nextLink` value

  Scenario: Cursor restart resumes correctly
    Given the puller has run successfully + cursor = "https://graph.microsoft.com/v1.0/auditLogs/...?$skiptoken=ABC"
    When the worker restarts and re-fires the puller
    Then `runOnce({ cursor: "https://graph.microsoft.com/v1.0/auditLogs/...?$skiptoken=ABC" })` is called
    And the puller resumes from the right page

  Scenario: Microsoft 401 surfaces as actionable
    Given Microsoft returns 401 (credentials expired)
    Then the puller fails with `errorCount = 1` + cursor unchanged
    And the IngestionSource UI shows "Microsoft authentication failed — please re-authorize at /settings/governance/ingestion-sources/<id>"
    And the next pull won't fire until the admin re-authenticates (back-off + alert; not infinite retry)

  Scenario: Future pullers follow the same pattern
    Given the openai_compliance + claude_compliance reference pullers eventually land
    Then they MUST: extend `HttpPollingPullerAdapter` (not implement PullerAdapter directly), export their reference config as a constant, lock URL + auth shape, allow only credentials override
    And the admin UI auto-discovers reference impls + presents them as one-click options
