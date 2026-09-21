/**
 * @vitest-environment node
 *
 * Integration coverage for the OCSF schema-versioning column added by
 * migration 00028 (Phase 5 forward-compat slice).
 *
 * Pins:
 *   1. Newly written events carry `OCSF_SCHEMA_VERSION` ("1.1.0")
 *      end-to-end through `insertEvent` → CH → `list` (the read service).
 *   2. Pre-this-column rows (synthesised here by writing a row WITHOUT
 *      OcsfSchemaVersion) materialize as the DEFAULT '1.1.0' on read.
 *      Backfill-free forward compat: existing CH rows from before
 *      migration 00028 still surface a sensible version string when the
 *      SIEM consumer pulls them.
 *   3. The version round-trips per-row, not just per-batch — when the
 *      writer constant bumps to v1.2 in a future PR, mixed-version
 *      pages must distinguish each row's actual version.
 *
 * Hits real ClickHouse (testcontainers); reads via the production
 * `GovernanceOcsfExportService.list` so we exercise the full SELECT
 * path that SIEM consumers see.
 *
 * The actor-placement block below runs the whole derive → store → export
 * path rather than writing a row by hand: the bug it pins was in the derive
 * step, and a test that inserted the row itself would decide the very thing
 * under test.
 *
 * Spec: specs/ai-gateway/governance/siem-export.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { prisma } from "~/server/db";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { TriggerContext } from "~/server/event-sourcing/pipeline/processManagerDefinition";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { createGovernanceOcsfEventsSyncHandler } from "../../subscribers/governanceOcsfEventsSync.subscriber";
import {
  GovernanceOcsfEventsClickHouseRepository,
  OCSF_ACTIVITY,
  OCSF_SCHEMA_VERSION,
  OCSF_SEVERITY,
} from "../governanceOcsfEvents.clickhouse.repository";
import { GovernanceOcsfExportService } from "../governanceOcsfExport.service";
import { PROJECT_KIND } from "../governanceProject.service";

const ns = `ocsf-ver-${nanoid(8)}`;

let organizationId: string;
let govProjectId: string;
let ch: ClickHouseClient;

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) {
    throw new Error("Test ClickHouse client not initialised");
  }
  ch = client;

  // Seed: org → team → hidden Gov Project. The export service resolves
  // the Gov Project by org via Prisma so we need a real PG row, then
  // CH rows keyed on that project's id.
  const organization = await prisma.organization.create({
    data: { name: `OCSF Ver Org ${ns}`, slug: `--ocsf-ver-${ns}` },
  });
  organizationId = organization.id;

  const team = await prisma.team.create({
    data: {
      name: `OCSF Ver Team ${ns}`,
      slug: `--ocsf-ver-team-${ns}`,
      organizationId,
    },
  });

  const govProject = await prisma.project.create({
    data: {
      name: "Governance (internal)",
      slug: `governance-${organizationId}`,
      apiKey: `key-${ns}`,
      teamId: team.id,
      kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      language: "internal",
      framework: "governance",
    },
  });
  govProjectId = govProject.id;
});

afterAll(async () => {
  await ch
    .command({
      query: `DELETE FROM governance_ocsf_events WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId: govProjectId },
    })
    .catch(() => {});
  await cleanupTestRows(prisma, [
    ["project", { team: { organizationId } }],
    ["team", { organizationId }],
    ["organization", { slug: `--ocsf-ver-${ns}` }],
  ]);
});

describe("OCSF schema-version forward-compat", () => {
  describe("write path stamps OCSF_SCHEMA_VERSION", () => {
    it("inserts the constant on every row written via insertEvent", async () => {
      const repo = new GovernanceOcsfEventsClickHouseRepository(async () => ch);
      const eventId = `evt-write-${ns}`;
      await repo.insertEvent({
        tenantId: govProjectId,
        eventId,
        traceId: `trace-${ns}-w`,
        sourceId: `src-${ns}`,
        sourceType: "otel_generic",
        activityId: OCSF_ACTIVITY.INVOKE,
        severityId: OCSF_SEVERITY.INFO,
        eventTime: new Date(Date.now() - 1000),
        actorUserId: "alice",
        actorEmail: "alice@example.com",
        actorEnduserId: "",
        actionName: "InvokeLLM",
        targetName: "gpt-5-mini",
        anomalyAlertId: "",
        rawOcsfJson: "{}",
      });

      // Wait for the async insert to settle so the next SELECT sees it.
      // wait_for_async_insert is set to 0 in the repo (production setting),
      // so we need a brief delay or explicit OPTIMIZE.
      await new Promise((resolve) => setTimeout(resolve, 500));

      const result = await ch.query({
        query: `
          SELECT OcsfSchemaVersion
          FROM governance_ocsf_events
          WHERE TenantId = {tenantId:String} AND EventId = {eventId:String}
          LIMIT 1
        `,
        query_params: { tenantId: govProjectId, eventId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{
        OcsfSchemaVersion: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.OcsfSchemaVersion).toBe(OCSF_SCHEMA_VERSION);
      expect(OCSF_SCHEMA_VERSION).toBe("1.1.0");
    });
  });

  describe("read path surfaces the version", () => {
    it("returns ocsfSchemaVersion='1.1.0' on each event from the export service", async () => {
      const repo = new GovernanceOcsfEventsClickHouseRepository(async () => ch);
      const eventId = `evt-read-${ns}`;
      await repo.insertEvent({
        tenantId: govProjectId,
        eventId,
        traceId: `trace-${ns}-r`,
        sourceId: `src-${ns}`,
        sourceType: "otel_generic",
        activityId: OCSF_ACTIVITY.INVOKE,
        severityId: OCSF_SEVERITY.INFO,
        eventTime: new Date(Date.now() - 500),
        actorUserId: "bob",
        actorEmail: "bob@example.com",
        actorEnduserId: "",
        actionName: "InvokeLLM",
        targetName: "gpt-5-mini",
        anomalyAlertId: "",
        rawOcsfJson: "{}",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      // The export service now takes its ClickHouse repository as a
      // constructor argument (ADR: repositories reached from the App, not
      // resolved ad hoc), so it can be pointed at the test client directly
      // instead of driving the SELECT by hand.
      const service = GovernanceOcsfExportService.create({
        prisma,
        ocsfRepository: repo,
      });
      const page = await service.list({
        organizationId,
        sinceMs: 0,
        limit: 10,
      });

      const event = page.events.find((e) => e.eventId === eventId);
      expect(event?.ocsfSchemaVersion).toBe("1.1.0");
    });
  });

  describe("backwards compatibility for pre-column rows", () => {
    it("rows inserted WITHOUT OcsfSchemaVersion materialize as the DEFAULT '1.1.0'", async () => {
      // Synthesise a "pre-migration-00028" row by inserting without
      // the OcsfSchemaVersion column. CH applies the column DEFAULT
      // ('1.1.0') at materialization. This proves that already-existing
      // governance_ocsf_events rows in customer ClickHouses (written
      // before this slice landed) surface a non-empty version string
      // through the export, so SIEM consumers don't see null/empty
      // and can't accidentally version-gate them out.
      const eventId = `evt-default-${ns}`;
      await ch.insert({
        table: "governance_ocsf_events",
        // Note: deliberately omitting OcsfSchemaVersion to simulate
        // pre-column rows. CH applies the DEFAULT at write time.
        values: [
          {
            TenantId: govProjectId,
            EventId: eventId,
            TraceId: `trace-${ns}-d`,
            SourceId: `src-${ns}`,
            SourceType: "otel_generic",
            ClassUid: 6003,
            CategoryUid: 6,
            ActivityId: 6,
            TypeUid: 600306,
            SeverityId: 1,
            EventTime: new Date(Date.now() - 250),
            ActorUserId: "carol",
            ActorEmail: "carol@example.com",
            ActorEnduserId: "",
            ActionName: "InvokeLLM",
            TargetName: "gpt-5-mini",
            AnomalyAlertId: "",
            RawOcsfJson: "{}",
          },
        ],
        format: "JSONEachRow",
      });
      await new Promise((resolve) => setTimeout(resolve, 500));

      const result = await ch.query({
        query: `
          SELECT OcsfSchemaVersion
          FROM governance_ocsf_events
          WHERE TenantId = {tenantId:String} AND EventId = {eventId:String}
          LIMIT 1
        `,
        query_params: { tenantId: govProjectId, eventId },
        format: "JSONEachRow",
      });
      const rows = (await result.json()) as Array<{
        OcsfSchemaVersion: string;
      }>;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.OcsfSchemaVersion).toBe("1.1.0");
    });
  });
});

describe("actor placement on the derive → export path", () => {
  /**
   * A governance trace fold, carrying only the attributes the OCSF
   * subscriber reads. Cast rather than fully built: the fold state has
   * ~30 fields and none of the others reach this path.
   */
  function govFoldState({
    traceId,
    attributes,
  }: {
    traceId: string;
    attributes: Record<string, string>;
  }): TraceSummaryData {
    return {
      traceId,
      models: [],
      occurredAt: Date.now() - 100,
      attributes: {
        "langwatch.origin.kind": "ingestion_source",
        "langwatch.ingestion_source.id": `src-${ns}`,
        "langwatch.ingestion_source.source_type": "otel_generic",
        ...attributes,
      },
    } as unknown as TraceSummaryData;
  }

  /** @scenario "An actor the trace names by an opaque id is exported as a user id, never as an email" */
  it("exports an opaque email attribute as the actor's user id, with an empty email", async () => {
    const repo = new GovernanceOcsfEventsClickHouseRepository(async () => ch);
    const subscriber = createGovernanceOcsfEventsSyncHandler({
      governanceOcsfEventsRepository: repo,
    });
    const traceId = `trace-${ns}-opaque`;
    // Named `user.email`, but not an address — and no user id attribute
    // beside it to hold the identifier instead.
    const context = {
      tenantId: govProjectId,
      aggregateId: traceId,
      state: govFoldState({
        traceId,
        attributes: { "user.email": "user-A1b2C3d4E5" },
      }),
    } as TriggerContext<TraceSummaryData>;

    await subscriber({} as unknown as TraceProcessingEvent, context);
    await new Promise((resolve) => setTimeout(resolve, 500));

    const service = GovernanceOcsfExportService.create({
      prisma,
      ocsfRepository: repo,
    });
    const page = await service.list({
      organizationId,
      sinceMs: 0,
      limit: 50,
    });

    const exported = page.events.find((e) => e.eventId === traceId);
    // The row must exist: an absent row would satisfy an "email is empty"
    // assertion on its own, so the guard is checked before it is trusted.
    expect(exported).toBeDefined();
    expect(exported?.actorUserId).toBe("user-A1b2C3d4E5");
    expect(exported?.actorEmail).toBe("");
  });
});
