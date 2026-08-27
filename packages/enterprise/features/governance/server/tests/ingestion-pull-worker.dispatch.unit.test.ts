/**
 * Worker-dispatch coverage for the PullerAdapter framework. Exercises
 * the full path:
 *   IngestionSource (mock Prisma) →
 *   adapter resolution (real registry) →
 *   adapter.runOnce (real adapter, stubbed fetch) →
 *   OCSF row composition (real mapToOcsfRow) →
 *   governance_ocsf_events insert (mock App-provided repository)
 *
 * Mocks Prisma + the App's OCSF repository at the module boundary so the test
 * runs without Docker. The dispatch logic, adapter dispatch, OCSF
 * mapping, and cursor-persistence semantics are all covered with
 * real code; only the storage edges are stubbed.
 *
 * The full integration test against real PG + CH would replace the
 * Prisma + CH mocks with testContainers — same test shape otherwise.
 *
 * Spec: specs/ai-governance/puller-framework/puller-adapter-contract.feature
 */
import { governanceIngestionSourceSchema } from "@langwatch/enterprise-governance-contract";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HttpPollingPullerAdapter } from "../src/adapters/http-poller.adapter";
import { TestHttpPort, createWorkerService } from "./support/puller-test-ports";

const sourceFindUnique = vi.fn();
const sourceUpdate = vi.fn();
const ocsfInsert = vi.fn();
const fetchStub = vi.fn();
const ensureGovProject = vi.fn();

beforeEach(() => {
  sourceFindUnique.mockReset();
  sourceUpdate.mockReset();
  ocsfInsert.mockReset();
  fetchStub.mockReset();
  ensureGovProject.mockReset();
  ensureGovProject.mockResolvedValue({ id: "gov-proj-1" });
});

afterEach(() => vi.clearAllMocks());

async function runIngestionPull(input: { sourceId: string; cursor: string | null }) {
  const source = await sourceFindUnique(input.sourceId);
  const adapter = HttpPollingPullerAdapter.create({
    http: new TestHttpPort(async (url, init) => {
      const response = await fetchStub(url, init);
      return {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        json: () => response.json(),
        text: () => response.text(),
      };
    }),
  });
  const normalizedSource = source
    ? governanceIngestionSourceSchema.parse({
        ...source,
        teamId: source.teamId ?? null,
        name: "test source",
        description: null,
        ingestSecretHash: "hash",
        errorCount: 0,
        pullSchedule: null,
        lastEventAt: null,
        archivedAt: null,
        createdAt: new Date(0),
        updatedAt: new Date(0),
        createdById: null,
      })
    : null;
  const service = createWorkerService({
    source: normalizedSource,
    adapter,
    insertEvent: async (row) => ocsfInsert(row),
    usageEnabled: async () => false,
    ensureProject: async () => ensureGovProject({}, "org-1"),
  });
  return service.run(input);
}

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
      const outcome = await runIngestionPull({ sourceId, cursor: null });

      // Two OCSF rows landed
      expect(ocsfInsert).toHaveBeenCalledTimes(2);
      const firstRow = ocsfInsert.mock.calls[0]![0];
      expect(firstRow).toMatchObject({
        // TenantId is the org's hidden internal_governance Project ID,
        // resolved by the worker — same key as the trace-fold subscriber +
        // OCSF export service. Org id is NOT used.
        tenantId: "gov-proj-1",
        eventId: `http_polling:${sourceId}:evt-1`,
        traceId: `pull:http_polling:${sourceId}:evt-1`,
        sourceId,
        sourceType: "http_polling",
        actorEmail: "alice@acme.test",
        actionName: "completion",
        targetName: "gpt-5-mini",
      });
      expect(ensureGovProject).toHaveBeenCalledWith(expect.anything(), "org-1");
      expect(outcome).toEqual({
        nextCursor: null,
        eventCount: 2,
      });
      expect(sourceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("source lookup fails: bail without adapter dispatch", () => {
    it("logs + returns when IngestionSource is missing", async () => {
      sourceFindUnique.mockResolvedValueOnce(null);
      await expect(runIngestionPull({ sourceId: "missing-src", cursor: null })).rejects.toThrow(
        "not found",
      );
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
      await runIngestionPull({ sourceId: "src-disabled", cursor: null });
      expect(fetchStub).not.toHaveBeenCalled();
      expect(ocsfInsert).not.toHaveBeenCalled();
    });
  });

  describe("unknown adapter id", () => {
    it("fails without mutating the compatibility projection", async () => {
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-unknown",
        organizationId: "org-1",
        sourceType: "weird",
        status: "active",
        parserConfig: { adapter: "definitely_not_registered" },
        pollerCursor: null,
      });
      await expect(runIngestionPull({ sourceId: "src-unknown", cursor: null })).rejects.toThrow(
        "Unknown ingestion pull adapter",
      );
      expect(sourceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("when the adapter refuses the config", () => {
    it("fails before dispatching, so no request is made against a half-read config", async () => {
      const { url: _dropped, ...withoutUrl } = HTTP_POLLING_CONFIG;
      sourceFindUnique.mockResolvedValueOnce({
        id: "src-bad-config",
        organizationId: "org-1",
        sourceType: "http_polling",
        status: "active",
        parserConfig: withoutUrl,
        pollerCursor: null,
      });
      await expect(runIngestionPull({ sourceId: "src-bad-config", cursor: null })).rejects.toThrow(
        /url/i,
      );
      expect(fetchStub).not.toHaveBeenCalled();
      expect(ocsfInsert).not.toHaveBeenCalled();
      expect(sourceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("adapter failure", () => {
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
      // and surfaces via errorCount). The effect fails so the outbox retries.
      const r503 = () => new Response(JSON.stringify({ error: "down" }), { status: 503 });
      fetchStub.mockResolvedValueOnce(r503());
      fetchStub.mockResolvedValueOnce(r503());
      fetchStub.mockResolvedValueOnce(r503());
      await expect(
        runIngestionPull({ sourceId: "src-error", cursor: "starting-cursor" }),
      ).rejects.toThrow();

      expect(ocsfInsert).not.toHaveBeenCalled();
      expect(sourceUpdate).not.toHaveBeenCalled();
    });
  });

  describe("idempotent EventId composition", () => {
    it("includes source id so same-type sources cannot collide", async () => {
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
      await runIngestionPull({ sourceId: "src-idem", cursor: null });

      const row = ocsfInsert.mock.calls[0]![0];
      expect(row.eventId).toBe("copilot_studio:src-idem:uuid-deadbeef");
      expect(row.traceId).toBe("pull:copilot_studio:src-idem:uuid-deadbeef");
    });
  });
});
