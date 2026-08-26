# RETIRED. This source reads Microsoft's directory audit — the log of
# directory changes — which has never contained a Copilot conversation and
# cannot be made to. Copilot conversations are read from Dataverse instead;
# see copilot-studio-dataverse.feature and ADR-088 Decision 15.
#
# The scenarios below are kept because rows configured on this source type
# still exist and must keep rendering, and because the framework behaviour
# they pin (cursor restart, 401 handling) is still the framework's contract.
# The source type is no longer offered in the picker, so nothing here may
# require creating one — see copilot-studio-dataverse.feature, which requires
# its absence from the picker outright.

Feature: Microsoft Copilot Studio reference puller (built on HttpPollingPullerAdapter)
  As a platform engineer who needs Copilot Studio audit-log ingestion working
  end-to-end without writing a custom adapter
  I want a reference implementation that uses HttpPollingPullerAdapter + a
  fixed config shape per Microsoft's audit-log API
  So that a source configured against it keeps running + the framework
  handles polling / pagination / event-mapping

  Background:
    Given the puller framework + HttpPollingPullerAdapter + S3PollingPullerAdapter are in place

  # Replaces "Admin enables Copilot Studio with one click". Creating one is no
  # longer possible and must not be: the type is out of the picker, and the
  # Dataverse feature requires it absent. What still has to hold is that a row
  # created before the retirement keeps being scheduled and read.
  Scenario: A source configured before the retirement keeps running
    Given an IngestionSource row already exists with `sourceType = "copilot_studio"` + `pullConfig = <reference config>` + `pullSchedule = "*/15 * * * *"`
    Then the process outbox keeps picking up its scheduled runs
    And the picker never offers "Microsoft Copilot Studio" as a new source

  Scenario: Reference config is locked + auditable
    Given the copilot_studio reference puller exists at `platform/app/ee/governance/services/pullers/copilotStudio.puller.ts`
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
    And the IngestionSource UI shows "Microsoft authentication failed. Re-authorize at /governance/inventory/<id>"
    And the next pull won't fire until the admin re-authenticates (back-off + alert; not infinite retry)

  Scenario: Future pullers follow the same pattern
    Given the openai_compliance + claude_compliance reference pullers eventually land
    Then they MUST: export their reference config as a constant, lock URL + auth shape, allow only credentials override
    And the admin UI auto-discovers reference impls + presents them as one-click options
    # This scenario originally also required extending `HttpPollingPullerAdapter`
    # rather than implementing `PullerAdapter` directly. That requirement is
    # withdrawn: it holds only for sources whose credential is a fixed value
    # known before the run, which is what that base class substitutes into
    # header templates. A source that must exchange credentials for a token
    # and refresh it on expiry has no seam there, and forcing the reuse would
    # push token machinery into a base class four adapters share for the sake
    # of one. See ADR-088 Decision 17 (v10.2). The rest of the pattern —
    # locked config, credentials-only override, auto-discovery — still binds.
