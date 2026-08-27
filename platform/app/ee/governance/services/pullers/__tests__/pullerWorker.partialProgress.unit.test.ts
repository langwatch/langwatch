/**
 * What a run that reported errors is worth, decided at the worker rather than
 * at the adapter.
 *
 * `errorCount > 0` carries two meanings and only the cursor tells them apart:
 * the adapter stepped past input it could not read (s3_polling does this for a
 * malformed line), or it got nowhere at all (http_polling returns the incoming
 * cursor when its transport fails). Treating the first as a failure discards
 * the events that WERE collected and the advance with them, so the next run
 * re-reads the same unreadable object and the source never moves again.
 *
 * The adapter half was already covered, in `s3PollingPullerAdapter.unit.test.ts`
 * ("skips malformed ndjson lines without aborting; cursor still advances"). It
 * passed while the source was stalling in production, because it stops one
 * layer below the decision. This file is the layer that was missing: the real
 * adapter and the real worker, together.
 *
 * Storage edges are stubbed at the module boundary (Prisma, the App's OCSF
 * sink, the S3 SDK) so it runs without Docker or AWS. The adapter, the
 * dispatch, and the progress decision are all real code.
 *
 * Spec: specs/ai-governance/puller-framework/s3-polling.feature
 */
import { Readable } from "node:stream";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PullResult } from "../pullerAdapter";

const sourceFindUnique = vi.fn();
const sourceUpdate = vi.fn();
const ocsfInsert = vi.fn();
const fetchStub = vi.fn();
const ensureGovProject = vi.fn();

interface StubObject {
  key: string;
  body: string;
}

let stubObjects: StubObject[] = [];
let listInvocations: { Prefix?: string; StartAfter?: string }[] = [];

beforeEach(() => {
  sourceFindUnique.mockReset();
  sourceUpdate.mockReset();
  ocsfInsert.mockReset();
  fetchStub.mockReset();
  ensureGovProject.mockReset();
  ensureGovProject.mockResolvedValue({ id: "gov-proj-1" });
  stubObjects = [];
  listInvocations = [];

  vi.doMock("~/server/db", () => ({
    prisma: {
      ingestionSource: {
        findUnique: sourceFindUnique,
        update: sourceUpdate,
      },
    },
  }));
  vi.doMock("~/server/app-layer/app", () => ({
    getApp: () => ({
      governance: {
        ocsfEvents: { insertEvent: async (row: unknown) => ocsfInsert(row) },
      },
    }),
  }));
  vi.doMock("../../governanceOcsfEvents.clickhouse.repository", () => ({
    OCSF_ACTIVITY: { CREATE: 1, READ: 2, UPDATE: 3, DELETE: 4, INVOKE: 6 },
    OCSF_SEVERITY: { INFO: 1, LOW: 3, MEDIUM: 4, HIGH: 5, CRITICAL: 6 },
  }));
  vi.doMock("../../governanceProject.service", () => ({
    ensureHiddenGovernanceProject: ensureGovProject,
  }));
  vi.doMock("~/utils/ssrfProtection", () => ({ ssrfSafeFetch: fetchStub }));
  vi.doMock("~/server/featureFlag", () => ({
    featureFlagService: { isEnabled: async () => false },
  }));

  // Same shape as the adapter's own unit test, so the two agree about what an
  // S3 listing looks like. `StartAfter` is honoured because the second run in
  // the stall test depends on it.
  vi.doMock("@aws-sdk/client-s3", async () => {
    class FakeListCmd {
      constructor(
        public readonly input: { Prefix?: string; StartAfter?: string },
      ) {}
    }
    class FakeGetCmd {
      constructor(public readonly input: { Bucket: string; Key: string }) {}
    }
    class FakeS3Client {
      async send(cmd: FakeListCmd | FakeGetCmd) {
        if (cmd instanceof FakeListCmd) {
          listInvocations.push(cmd.input);
          const filtered = stubObjects.filter((o) => {
            if (cmd.input.Prefix && !o.key.startsWith(cmd.input.Prefix))
              return false;
            if (cmd.input.StartAfter && o.key <= cmd.input.StartAfter)
              return false;
            return true;
          });
          return {
            Contents: filtered.map((o) => ({ Key: o.key })),
            IsTruncated: false,
          };
        }
        if (cmd instanceof FakeGetCmd) {
          const obj = stubObjects.find((o) => o.key === cmd.input.Key);
          if (!obj) throw new Error(`stub: missing ${cmd.input.Key}`);
          return { Body: Readable.from([Buffer.from(obj.body, "utf-8")]) };
        }
        throw new Error("stub: unknown cmd");
      }
    }
    return {
      S3Client: FakeS3Client,
      ListObjectsV2Command: FakeListCmd,
      GetObjectCommand: FakeGetCmd,
    };
  });
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

const PREFIX = "anthropic/compliance/";

const S3_CONFIG = {
  adapter: "s3_polling",
  bucket: "acme-audit",
  prefix: PREFIX,
  region: "us-east-1",
  parser: "ndjson",
  schedule: "0 * * * *",
  credentials: {
    aws_access_key_id: "test-key",
    aws_secret_access_key: "test-secret",
  },
  eventMapping: {
    source_event_id: "$.id",
    event_timestamp: "$.timestamp",
    actor: "$.user_email",
    action: "$.event",
    target: "$.model",
    cost_usd: "$.cost",
    tokens_input: "$.tokens_in",
    tokens_output: "$.tokens_out",
  },
};

const HTTP_CONFIG = {
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

const record = (id: string) =>
  JSON.stringify({
    id,
    timestamp: "2026-05-03T10:00:00Z",
    user_email: "alice@acme.test",
    event: "completion",
    model: "gpt-5-mini",
    cost: 0.001,
    tokens_in: 12,
    tokens_out: 4,
  });

const s3Source = (sourceId: string, cursor: string | null) => ({
  id: sourceId,
  organizationId: "org-1",
  sourceType: "s3_polling",
  status: "active",
  parserConfig: S3_CONFIG,
  pollerCursor: cursor,
});

describe("a pull run that reported errors", () => {
  describe("given the adapter skipped a record and advanced past it", () => {
    beforeEach(() => {
      stubObjects = [
        { key: `${PREFIX}a.ndjson`, body: [record("evt-1"), record("evt-2")].join("\n") },
        { key: `${PREFIX}b.ndjson`, body: `${record("evt-3")}\nnot json at all` },
      ];
    });

    describe("when the worker runs it", () => {
      /** @scenario "Malformed file skipped, run continues" */
      it("keeps the events it did collect rather than discarding the whole run", async () => {
        const sourceId = "src-partial-1";
        sourceFindUnique.mockResolvedValueOnce(s3Source(sourceId, null));

        const { runIngestionPull } = await import("../pullerWorker");
        const outcome = await runIngestionPull({ sourceId, cursor: null });

        expect(ocsfInsert).toHaveBeenCalledTimes(3);
        expect(outcome.eventCount).toBe(3);
      });

      /** @scenario "Malformed file skipped, run continues" */
      it("reports the skipped record rather than swallowing it", async () => {
        const sourceId = "src-partial-2";
        sourceFindUnique.mockResolvedValueOnce(s3Source(sourceId, null));

        const { runIngestionPull } = await import("../pullerWorker");
        const outcome = await runIngestionPull({ sourceId, cursor: null });

        expect(outcome.errorCount).toBe(1);
      });

      /** @scenario "Malformed file skipped, run continues" */
      it("advances the cursor past the file it could not fully read", async () => {
        const sourceId = "src-partial-3";
        sourceFindUnique.mockResolvedValueOnce(s3Source(sourceId, null));

        const { runIngestionPull } = await import("../pullerWorker");
        const outcome = await runIngestionPull({ sourceId, cursor: null });

        expect(outcome.nextCursor).toBe(`${PREFIX}b.ndjson`);
      });

      /**
       * The property the ticket is actually about. Every assertion above can
       * hold on a single run while the source still never moves, because what
       * stalled it was the NEXT run re-reading the same object. So the next run
       * is what is asserted: it must start after the bad file, not at it.
       *
       * @scenario "Malformed file skipped, run continues"
       */
      it("does not re-read the same file on the next run, so the source is not stalled", async () => {
        const sourceId = "src-partial-4";
        sourceFindUnique.mockResolvedValueOnce(s3Source(sourceId, null));

        const { runIngestionPull } = await import("../pullerWorker");
        const first = await runIngestionPull({ sourceId, cursor: null });

        sourceFindUnique.mockResolvedValueOnce(
          s3Source(sourceId, first.nextCursor),
        );
        listInvocations = [];
        await runIngestionPull({ sourceId, cursor: first.nextCursor });

        expect(listInvocations.at(-1)?.StartAfter).toBe(`${PREFIX}b.ndjson`);
      });
    });
  });

  describe("given the adapter could not make progress at all", () => {
    describe("when the worker runs it", () => {
      it("fails the run, so the same window is retried rather than skipped", async () => {
        const sourceId = "src-stuck-1";
        sourceFindUnique.mockResolvedValueOnce({
          id: sourceId,
          organizationId: "org-1",
          sourceType: "http_polling",
          status: "active",
          parserConfig: HTTP_CONFIG,
          pollerCursor: "page-7",
        });
        fetchStub.mockRejectedValue(new Error("connection reset"));

        const { runIngestionPull } = await import("../pullerWorker");

        await expect(
          runIngestionPull({ sourceId, cursor: "page-7" }),
        ).rejects.toThrow(/reported 1 error/);
      });

      it("writes nothing, so a failed transport cannot half-land a window", async () => {
        const sourceId = "src-stuck-2";
        sourceFindUnique.mockResolvedValueOnce({
          id: sourceId,
          organizationId: "org-1",
          sourceType: "http_polling",
          status: "active",
          parserConfig: HTTP_CONFIG,
          pollerCursor: "page-7",
        });
        fetchStub.mockRejectedValue(new Error("connection reset"));

        const { runIngestionPull } = await import("../pullerWorker");
        await expect(
          runIngestionPull({ sourceId, cursor: "page-7" }),
        ).rejects.toThrow();

        expect(ocsfInsert).not.toHaveBeenCalled();
      });
    });
  });

  /**
   * Driven through a registered stub rather than a real adapter, deliberately.
   *
   * No shipped adapter returns errors together with a null cursor: s3_polling
   * sets its cursor on every key it touches including one it failed to read,
   * and http_polling, anthropic_admin and databricks_genie all hand back the
   * cursor they were given. So this rule cannot be reached from production
   * code today, and a mutation that deletes it survives every test written
   * against a real adapter.
   *
   * It is worth stating anyway, and worth a test that says so, because it is
   * the difference between a stalled source and a source that silently
   * re-ingests its entire history. The next adapter is what makes it
   * reachable, and it will not come with this reasoning attached.
   */
  describe("given the adapter reported errors and handed back a null cursor", () => {
    const nullCursorAdapter = {
      id: "test_null_cursor",
      validateConfig: (config: unknown) => config,
      runOnce: (): Promise<PullResult> =>
        Promise.resolve({ events: [], cursor: null, errorCount: 1 }),
    };

    const advancingAdapter = {
      id: "test_advancing",
      validateConfig: (config: unknown) => config,
      runOnce: (): Promise<PullResult> =>
        Promise.resolve({ events: [], cursor: "cursor-B", errorCount: 1 }),
    };

    async function runWith(adapter: { id: string }, sourceId: string) {
      sourceFindUnique.mockResolvedValueOnce({
        id: sourceId,
        organizationId: "org-1",
        sourceType: adapter.id,
        status: "active",
        parserConfig: { adapter: adapter.id },
        pollerCursor: "cursor-A",
      });
      const { pullerAdapterRegistry } = await import("../pullerAdapter");
      pullerAdapterRegistry.register(adapter as never);
      const { runIngestionPull } = await import("../pullerWorker");
      return runIngestionPull({ sourceId, cursor: "cursor-A" });
    }

    describe("when the worker runs it", () => {
      it("fails the run rather than rewinding the source to the beginning", async () => {
        await expect(
          runWith(nullCursorAdapter, "src-null-1"),
        ).rejects.toThrow(/reported 1 error/);
      });
    });

    describe("when the same adapter hands back a real cursor instead", () => {
      it("accepts it as progress, so the rule is about null and not about errors", async () => {
        const outcome = await runWith(advancingAdapter, "src-advance-1");
        expect(outcome.nextCursor).toBe("cursor-B");
        expect(outcome.errorCount).toBe(1);
      });
    });
  });
});
