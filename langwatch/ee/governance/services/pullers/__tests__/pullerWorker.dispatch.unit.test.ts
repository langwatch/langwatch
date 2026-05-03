/**
 * Worker-dispatch coverage for the PullerAdapter framework. Exercises
 * the full path:
 *   IngestionSource (mock Prisma) →
 *   adapter resolution (real registry) →
 *   adapter.runOnce (real adapter, stubbed fetch) →
 *   OCSF row composition (real mapToOcsfRow) →
 *   governance_ocsf_events insert (mock CH client)
 *
 * Mocks Prisma + the CH client at the module boundary so the test
 * runs without Docker. The dispatch logic, adapter dispatch, OCSF
 * mapping, and cursor-persistence semantics are all covered with
 * real code; only the storage edges are stubbed.
 *
 * The full integration test against real PG + CH would replace the
 * Prisma + CH mocks with testContainers — same test shape otherwise.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sourceFindUnique = vi.fn();
const sourceUpdate = vi.fn();
const ocsfInsert = vi.fn();
const fetchStub = vi.fn();

beforeEach(() => {
  sourceFindUnique.mockReset();
  sourceUpdate.mockReset();
  ocsfInsert.mockReset();
  fetchStub.mockReset();

  vi.doMock("~/server/db", () => ({
    prisma: {
      ingestionSource: {
        findUnique: sourceFindUnique,
        update: sourceUpdate,
      },
    },
  }));
  vi.doMock("~/server/clickhouse/clickhouseClient", () => ({
    getClickHouseClientForOrganization: async () => ({}),
  }));
  vi.doMock("../../governanceOcsfEvents.clickhouse.repository", () => ({
    GovernanceOcsfEventsClickHouseRepository: class {
      async insertEvent(row: unknown) {
        return ocsfInsert(row);
      }
    },
    OCSF_ACTIVITY: { CREATE: 1, READ: 2, UPDATE: 3, DELETE: 4, INVOKE: 6 },
    OCSF_SEVERITY: { INFO: 1, LOW: 3, MEDIUM: 4, HIGH: 5, CRITICAL: 6 },
  }));
  vi.doMock("~/utils/ssrfProtection", () => ({
    ssrfSafeFetch: fetchStub,
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const HTTP_POLLING_CONFIG = {
  adapter: "http_polling",
  url: "https://api.example.test/v1/audit-log",
  method: "GET",
  headers: { Authorization: "Bearer ${{credentials.token}}" },
  authMode: "header_template",
  credentialRef: "test_creds",
  cursorJsonPath: "$.next_cursor",
  cursorQueryParam: "cursor",
  eventsJsonPath: "$.events",
  schedule: "*/5 * * * *",
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.created_at",
    actor: "$.user.email",
    action: "$.event_type",
    target: "$.model",
    cost_usd: "$.usage.cost",
    tokens_input: "$.usage.input_tokens",
    tokens_output: "$.usage.output_tokens",
  },
  credentials: { token: "test-secret" },
};

describe("pullerWorker dispatch end-to-end (mocked storage edges)", () => {
  describe("happy path: http_polling source produces 2 OCSF rows", () => {
    it("looks up source → resolves adapter → fetches events → writes OCSF + advances cursor", async () => {
      const sourceId = "src-happy-1";
      sourceFindUnique.mockResolvedValueOnce({
        id: sourceId,
        organizationId: "org-1",
        sourceType: "http_polling",
        status: "awaiting_first_event",
        parserConfig: HTTP_POLLING_CONFIG,
        pollerCursor: null,
      });
      fetchStub.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            events: [
              {
                id: "evt-1",
                created_at: "2026-05-03T10:00:00Z",
                user: { email: "alice@acme.test" },
                event_type: "completion",
                model: "gpt-5-mini",
                usage: { cost: 0.001, input_tokens: 12, output_tokens: 4 },
              },
              {
                id: "evt-2",
                created_at: "2026-05-03T10:01:00Z",
                user: { email: "bob@acme.test" },
                event_type: "completion",
                model: "gpt-5-mini",
                usage: { cost: 0.002, input_tokens: 30, output_tokens: 10 },
              },
            ],
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const { runIngestionPullerJob } = await import("../pullerWorker");

      await runIngestionPullerJob({
        id: "job-1",
        data: { ingestionSourceId: sourceId, scheduledAt: Date.now() },
      } as any);

      // Two OCSF rows landed
      expect(ocsfInsert).toHaveBeenCalledTimes(2);
      const firstRow = ocsfInsert.mock.calls[0]![0];
      expect(firstRow).toMatchObject({
        tenantId: "org-1",
        eventId: "http_polling:evt-1",
        traceId: "pull:http_polling:evt-1",
        sourceId,
        sourceType: "http_polling",
        actorEmail: "alice@acme.test",
        actionName: "completion",
        targetName: "gpt-5-mini",
      });
      // Cursor advanced + status promoted to active + lastEventAt stamped
      expect(sourceUpdate).toHaveBeenCalledTimes(1);
      const updateCall = sourceUpdate.mock.calls[0]![0];
      expect(updateCall.where).toEqual({ id: sourceId });
      expect(updateCall.data.status).toBe("active");
      expect(updateCall.data.lastEventAt).toBeInstanceOf(Date);
      expect(updateCall.data.errorCount).toBe(0);
    });
  });

  describe("source lookup fails: bail without adapter dispatch", () => {
    it("logs + returns when IngestionSource is missing", async () => {
      sourceFindUnique.mockResolvedValueOnce(null);
      const { runIngestionPullerJob } = await import("../pullerWorker");
      await runIngestionPullerJob({
        id: "job-1",
        data: { ingestionSourceId: "missing-src", scheduledAt: Date.now() },
      } as any);
      expect(ocsfInsert).not.toHaveBeenCalled();
      expect(sourceUpdate).not.toHaveBeenCalled();
    });

    it("skips when source status is 'disabled'", async () => {
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-disabled",
        organizationId: "org-1",
        sourceType: "http_polling",
        status: "disabled",
        parserConfig: HTTP_POLLING_CONFIG,
        pollerCursor: null,
      });
      const { runIngestionPullerJob } = await import("../pullerWorker");
      await runIngestionPullerJob({
        id: "job-1",
        data: { ingestionSourceId: "src-disabled", scheduledAt: Date.now() },
      } as any);
      expect(fetchStub).not.toHaveBeenCalled();
      expect(ocsfInsert).not.toHaveBeenCalled();
    });
  });

  describe("unknown adapter id: increments errorCount + skips", () => {
    it("logs + bumps errorCount when pullConfig.adapter doesn't resolve", async () => {
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-unknown",
        organizationId: "org-1",
        sourceType: "weird",
        status: "active",
        parserConfig: { adapter: "definitely_not_registered" },
        pollerCursor: null,
      });
      const { runIngestionPullerJob } = await import("../pullerWorker");
      await runIngestionPullerJob({
        id: "job-1",
        data: { ingestionSourceId: "src-unknown", scheduledAt: Date.now() },
      } as any);
      expect(sourceUpdate).toHaveBeenCalledTimes(1);
      expect(sourceUpdate.mock.calls[0]![0].data).toEqual({
        errorCount: { increment: 1 },
      });
    });
  });

  describe("adapter throws: leaves cursor untouched + bumps errorCount", () => {
    it("does not advance cursor when runOnce surfaces a transport error", async () => {
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-error",
        organizationId: "org-1",
        sourceType: "http_polling",
        status: "active",
        parserConfig: HTTP_POLLING_CONFIG,
        pollerCursor: "starting-cursor",
      });
      // 3x 503 — exhausts the adapter's retry budget; runOnce returns
      // a PullResult with errorCount=1 (does NOT throw — adapter swallows
      // and surfaces via errorCount). Worker sees errorCount>0 and bumps.
      const r503 = () =>
        new Response(JSON.stringify({ error: "down" }), { status: 503 });
      fetchStub.mockResolvedValueOnce(r503());
      fetchStub.mockResolvedValueOnce(r503());
      fetchStub.mockResolvedValueOnce(r503());

      const { runIngestionPullerJob } = await import("../pullerWorker");
      await runIngestionPullerJob({
        id: "job-1",
        data: { ingestionSourceId: "src-error", scheduledAt: Date.now() },
      } as any);

      expect(ocsfInsert).not.toHaveBeenCalled();
      // Adapter returned errorCount=1 + cursor=options.cursor;
      // worker preserves the cursor (passes-through) + increments errorCount.
      const updateCall = sourceUpdate.mock.calls[0]![0];
      expect(updateCall.data.errorCount).toEqual({ increment: 1 });
      // pollerCursor in the update equals the original cursor (it was never advanced)
      // — Prisma.JsonNull only used when cursor === null
      expect(updateCall.data.pollerCursor).toBe("starting-cursor");
    });
  });

  describe("idempotent EventId composition", () => {
    it("composes <sourceType>:<source_event_id> so replays collapse on the CH key", async () => {
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-idem",
        organizationId: "org-x",
        sourceType: "copilot_studio",
        status: "active",
        parserConfig: HTTP_POLLING_CONFIG,
        pollerCursor: null,
      });
      fetchStub.mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            events: [
              {
                id: "uuid-deadbeef",
                created_at: "2026-05-03T10:00:00Z",
                user: { email: "x@y" },
                event_type: "completion",
                model: "m",
                usage: { cost: 0, input_tokens: 0, output_tokens: 0 },
              },
            ],
            next_cursor: null,
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
      );

      const { runIngestionPullerJob } = await import("../pullerWorker");
      await runIngestionPullerJob({
        id: "job-1",
        data: { ingestionSourceId: "src-idem", scheduledAt: Date.now() },
      } as any);

      const row = ocsfInsert.mock.calls[0]![0];
      expect(row.eventId).toBe("copilot_studio:uuid-deadbeef");
      expect(row.traceId).toBe("pull:copilot_studio:uuid-deadbeef");
    });
  });
});
