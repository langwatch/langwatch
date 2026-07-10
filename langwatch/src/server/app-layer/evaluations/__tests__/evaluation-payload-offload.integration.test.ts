/**
 * @vitest-environment node
 * @integration
 *
 * End-to-end integration for evaluation-inputs offload (ADR-039) against real
 * infrastructure: a real ClickHouse (local native CH via TEST_CLICKHOUSE_URL,
 * or the CI service container), a real StoredObjectsService backed by a
 * LocalFilesystemDriver on a per-test temp dir, the real event_log repository,
 * and the real evaluation_runs repository. No boundary under test is mocked -
 * only `getClickHouseClientForProject` is wired to the test client so the
 * stored-objects repository routes to the same database.
 *
 * Covers the feature-file scenarios:
 *  - oversized inputs are offloaded, not truncated (marker + durable object)
 *  - event_log EventPayload carries the marker, not the full inputs
 *  - evaluation_runs.Inputs stays bounded
 *  - a read returns byte-identical inputs (resolution seam)
 *  - under-threshold inputs stay inline unchanged
 *  - inputs beyond the hard ceiling are bounded with a preview-only marker
 *  - offloaded bytes are recorded per tenant (getStorageUsageByProject)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTenantId } from "~/server/event-sourcing/domain/tenantId";
import {
  EVALUATION_REPORTED_EVENT_TYPE,
  EVALUATION_REPORTED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/constants";
import type { EvaluationReportedEvent } from "~/server/event-sourcing/pipelines/evaluation-processing/schemas/events";
import { EventRepositoryClickHouse } from "~/server/event-sourcing/stores/repositories/eventRepositoryClickHouse";
import { eventToRecord } from "~/server/event-sourcing/stores/eventStoreUtils";
import { EventUtils } from "~/server/event-sourcing/utils/event.utils";
import { LocalFilesystemDriver } from "~/server/stored-objects/local-filesystem-driver";
import { StorageRegistry } from "~/server/stored-objects/storage-registry";
import { StoredObjectsRepository } from "~/server/stored-objects/stored-objects.repository";
import type { MintStorageUri } from "~/server/stored-objects/stored-objects.service";
import { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import { mintFileUri } from "~/server/stored-objects/uri";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as clickhouseClientModule from "~/server/clickhouse/clickhouseClient";
import { EvaluationRunClickHouseRepository } from "../repositories/evaluation-run.clickhouse.repository";
import type { EvaluationRunData } from "../types";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_STORED_OBJECT_PURPOSE,
  isStoredObjectMarker,
  offloadInputsIfOversized,
  resolveInputsMarker,
  STORED_OBJECT_MARKER_KEY,
} from "../evaluation-inputs-offload";
import { EvaluationService } from "~/server/evaluations/evaluation.service";
import { getTestClickHouseClient } from "../../../event-sourcing/__tests__/integration/testContainers";

// Route the stored-objects repository (which resolves its client internally)
// to the shared test client. Everything else uses injected clients.
vi.mock("~/server/clickhouse/clickhouseClient", async () => {
  const actual = await vi.importActual<typeof clickhouseClientModule>(
    "~/server/clickhouse/clickhouseClient",
  );
  return {
    ...actual,
    getClickHouseClientForProject: vi.fn(),
  };
});

const tenantId = `test-eval-offload-${nanoid()}`;

let ch: ClickHouseClient;
let tmpDir: string;
let evalRepo: EvaluationRunClickHouseRepository;
let eventRepo: EventRepositoryClickHouse;

function buildStoredObjects(): StoredObjectsService {
  const driver = new LocalFilesystemDriver();
  const registry = new StorageRegistry({ file: driver, s3: driver });
  const repository = new StoredObjectsRepository();
  const mintUri: MintStorageUri = async ({ projectId, sha256 }) =>
    mintFileUri({ root: tmpDir, projectId, sha256 });
  return new StoredObjectsService(repository, registry, mintUri);
}

/** Builds an inputs object whose JSON serialization is at least `bytes` long. */
function inputsOfSize(bytes: number): { blob: string } {
  const overhead = JSON.stringify({ blob: "" }).length;
  return { blob: "x".repeat(Math.max(0, bytes - overhead)) };
}

function makeEvalData(
  overrides: Partial<EvaluationRunData> & { evaluationId: string },
): EvaluationRunData {
  const now = Date.now();
  return {
    evaluatorId: "evaluator-1",
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId: `trace-${nanoid()}`,
    isGuardrail: false,
    status: "processed",
    score: 1,
    passed: true,
    label: null,
    details: "ok",
    inputs: null,
    error: null,
    errorDetails: null,
    createdAt: now,
    updatedAt: now,
    LastEventOccurredAt: now,
    archivedAt: null,
    scheduledAt: now,
    startedAt: now,
    completedAt: now,
    costId: null,
    ...overrides,
  };
}

async function selectInputsRaw(evaluationId: string): Promise<string | null> {
  const result = await ch.query({
    query: `
      SELECT argMax(Inputs, UpdatedAt) AS Inputs
      FROM evaluation_runs
      WHERE TenantId = {tenantId:String}
        AND EvaluationId = {evaluationId:String}
    `,
    query_params: { tenantId, evaluationId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ Inputs: string | null }>();
  return rows[0]?.Inputs ?? null;
}

async function selectEventPayload(aggregateId: string): Promise<string> {
  const result = await ch.query({
    query: `
      SELECT EventPayload
      FROM event_log
      WHERE TenantId = {tenantId:String}
        AND AggregateType = 'evaluation'
        AND AggregateId = {aggregateId:String}
      LIMIT 1
    `,
    query_params: { tenantId, aggregateId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ EventPayload: string }>();
  return rows[0]?.EventPayload ?? "";
}

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("ClickHouse test container not available");
  ch = client;
  vi.mocked(
    clickhouseClientModule.getClickHouseClientForProject,
  ).mockResolvedValue(ch);

  evalRepo = new EvaluationRunClickHouseRepository(async () => ch);
  eventRepo = new EventRepositoryClickHouse(async () => ch);

  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "eval-offload-int-"));
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE evaluation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE event_log DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE stored_objects DELETE WHERE project_id = {projectId:String}`,
      query_params: { projectId: tenantId },
    });
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("evaluation inputs offload (integration)", () => {
  describe("given an evaluation run whose inputs exceed the inline threshold", () => {
    /** @scenario "an oversized evaluation input is offloaded, not truncated" */
    /** @scenario "evaluation events stay bounded in the event log" */
    it("offloads to a durable object, keeps event_log and the row bounded, and reads back byte-identical", async () => {
      const storedObjects = buildStoredObjects();
      const evaluationId = `eval-big-${nanoid()}`;
      const originalInputs = {
        ...inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 4096),
        meta: { rag: ["chunk-a", "chunk-b"], q: "café ☕" },
      };
      const originalSerialized = JSON.stringify(originalInputs);

      // Offload → marker + durable object (the write-time step in emitReported).
      const { inputs: offloaded, offloaded: didOffload } =
        await offloadInputsIfOversized({
          inputs: originalInputs,
          projectId: tenantId,
          evaluationId,
          storedObjects,
        });
      expect(didOffload).toBe(true);
      expect(isStoredObjectMarker(offloaded)).toBe(true);

      // (a) event_log EventPayload carries the marker, not the full inputs.
      const event = EventUtils.createEvent<EvaluationReportedEvent>({
        aggregateType: "evaluation",
        aggregateId: evaluationId,
        tenantId: createTenantId(tenantId),
        type: EVALUATION_REPORTED_EVENT_TYPE,
        version: EVALUATION_REPORTED_EVENT_VERSION_LATEST,
        data: {
          evaluationId,
          evaluatorId: "evaluator-1",
          evaluatorType: "test/evaluator",
          status: "processed",
          score: 1,
          passed: true,
          inputs: offloaded,
        } as EvaluationReportedEvent["data"],
        occurredAt: Date.now(),
        idempotencyKey: `${tenantId}:${evaluationId}:reported`,
      });
      await eventRepo.insertEventRecords([eventToRecord(event)]);

      const payloadStr = await selectEventPayload(evaluationId);
      expect(payloadStr).toContain(STORED_OBJECT_MARKER_KEY);
      // The full blob padding must NOT be inline in the event payload.
      expect(payloadStr).not.toContain(originalInputs.blob);
      expect(Buffer.byteLength(payloadStr, "utf8")).toBeLessThan(
        EVAL_INPUTS_INLINE_MAX_BYTES,
      );

      // (b) evaluation_runs.Inputs row stays bounded (the marker only).
      await evalRepo.upsert(
        makeEvalData({ evaluationId, inputs: offloaded }),
        tenantId,
      );
      const rowInputs = await selectInputsRaw(evaluationId);
      expect(rowInputs).toBeTruthy();
      expect(rowInputs!).toContain(STORED_OBJECT_MARKER_KEY);
      expect(rowInputs).not.toContain(originalInputs.blob);
      expect(Buffer.byteLength(rowInputs!, "utf8")).toBeLessThan(
        EVAL_INPUTS_INLINE_MAX_BYTES,
      );

      // (c) a stored_objects row exists with the correct size_bytes + project_id.
      const marker = (offloaded as Record<string, any>)[
        STORED_OBJECT_MARKER_KEY
      ];
      const soResult = await ch.query({
        query: `
          SELECT project_id, size_bytes, purpose, owner_id
          FROM stored_objects
          WHERE project_id = {projectId:String} AND id = {id:String}
          LIMIT 1
        `,
        query_params: { projectId: tenantId, id: marker.id },
        format: "JSONEachRow",
      });
      const soRows = await soResult.json<{
        project_id: string;
        size_bytes: string | number;
        purpose: string;
        owner_id: string;
      }>();
      expect(soRows.length).toBe(1);
      expect(soRows[0]!.project_id).toBe(tenantId);
      expect(Number(soRows[0]!.size_bytes)).toBe(
        Buffer.byteLength(originalSerialized, "utf8"),
      );
      expect(soRows[0]!.purpose).toBe(EVAL_INPUTS_STORED_OBJECT_PURPOSE);
      expect(soRows[0]!.owner_id).toBe(evaluationId);

      // (d) resolve returns byte-identical original inputs.
      const parsedRowInputs = JSON.parse(rowInputs!) as Record<string, unknown>;
      const resolved = await resolveInputsMarker({
        inputs: parsedRowInputs,
        projectId: tenantId,
        storedObjects,
      });
      expect(resolved).toEqual(originalInputs);
    });
  });

  describe("given an offloaded evaluation read through the lazy getEvaluationInputs seam", () => {
    /** @scenario "reading an offloaded evaluation run returns the full inputs" */
    it("returns the full inputs so the caller cannot tell they were offloaded", async () => {
      const storedObjects = buildStoredObjects();
      const evaluationId = `eval-lazy-${nanoid()}`;
      const originalInputs = {
        ...inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 2048),
        tag: "lazy-read",
      };

      const { inputs: offloaded } = await offloadInputsIfOversized({
        inputs: originalInputs,
        projectId: tenantId,
        evaluationId,
        storedObjects,
      });
      await evalRepo.upsert(
        makeEvalData({ evaluationId, inputs: offloaded }),
        tenantId,
      );

      // The v1 read service resolves the marker at the read boundary. Inject
      // the same stored-objects service the write used (its client is the test
      // client via the getClickHouseClientForProject mock).
      const service = new EvaluationService(({ projectId, inputs }) =>
        resolveInputsMarker({ projectId, inputs, storedObjects }),
      );
      const readInputs = await service.getEvaluationInputs({
        projectId: tenantId,
        evaluationId,
      });

      expect(readInputs).toEqual(originalInputs);
    });
  });

  describe("given an evaluation run whose inputs are under the threshold", () => {
    it("keeps them inline and writes no stored object", async () => {
      const storedObjects = buildStoredObjects();
      const evaluationId = `eval-small-${nanoid()}`;
      const inputs = { question: "what?", answer: "this", nested: { n: 1 } };

      const { inputs: maybeOffloaded, offloaded } =
        await offloadInputsIfOversized({
          inputs,
          projectId: tenantId,
          evaluationId,
          storedObjects,
        });
      expect(offloaded).toBe(false);
      expect(maybeOffloaded).toBe(inputs);

      await evalRepo.upsert(
        makeEvalData({ evaluationId, inputs: maybeOffloaded }),
        tenantId,
      );
      const rowInputs = await selectInputsRaw(evaluationId);
      expect(JSON.parse(rowInputs!)).toEqual(inputs);
      expect(rowInputs).not.toContain(STORED_OBJECT_MARKER_KEY);
    });
  });

  describe("given an evaluation run whose inputs exceed the hard ceiling", () => {
    /** @scenario "inputs beyond the hard ceiling are bounded with an observable marker" */
    it("bounds the row with a preview-only marker and writes no stored object", async () => {
      const storedObjects = buildStoredObjects();
      const evaluationId = `eval-ceiling-${nanoid()}`;
      const inputs = inputsOfSize(EVAL_INPUTS_HARD_CEILING_BYTES + 8192);

      const soBefore = await storedObjects.getStorageUsageByProject({
        projectId: tenantId,
      });

      const { inputs: bounded, offloaded } = await offloadInputsIfOversized({
        inputs,
        projectId: tenantId,
        evaluationId,
        storedObjects,
      });
      expect(offloaded).toBe(false);
      expect(isStoredObjectMarker(bounded)).toBe(true);
      const marker = (bounded as Record<string, any>)[STORED_OBJECT_MARKER_KEY];
      expect(marker.ceilingExceeded).toBe(true);
      expect(marker.id).toBe("");

      await evalRepo.upsert(
        makeEvalData({ evaluationId, inputs: bounded }),
        tenantId,
      );
      const rowInputs = await selectInputsRaw(evaluationId);
      expect(Buffer.byteLength(rowInputs!, "utf8")).toBeLessThan(
        EVAL_INPUTS_INLINE_MAX_BYTES,
      );

      // No new stored object was created for the ceiling case.
      const soAfter = await storedObjects.getStorageUsageByProject({
        projectId: tenantId,
      });
      expect(soAfter.objectCount).toBe(soBefore.objectCount);
    });
  });

  describe("given a fat un-offloaded payload reaching the repository directly (flag off / foreign writer)", () => {
    /** @scenario "evaluation rows stay merge-safe regardless of input size" */
    it("caps evaluation_runs.Inputs at the unconditional row budget with a valid-JSON marker", async () => {
      const evaluationId = `eval-uncapped-${nanoid()}`;
      // 9 MiB of raw inputs, no offload - exercises the belt-and-braces cap.
      const fatInputs = inputsOfSize(9 * 1024 * 1024);

      await evalRepo.upsert(
        makeEvalData({ evaluationId, inputs: fatInputs }),
        tenantId,
      );

      const rowInputs = await selectInputsRaw(evaluationId);
      expect(rowInputs).toBeTruthy();
      // Bounded well under the 9 MiB original; the merge-safe budget is 8 MiB.
      expect(Buffer.byteLength(rowInputs!, "utf8")).toBeLessThan(1024);
      // Still valid JSON so every reader's JSON.parse(Inputs) keeps working.
      const parsed = JSON.parse(rowInputs!);
      expect(parsed.__lw_truncated).toBeDefined();
      expect(parsed.__lw_truncated.originalBytes).toBe(
        Buffer.byteLength(JSON.stringify(fatInputs), "utf8"),
      );
    });
  });

  describe("given offloaded objects under a project", () => {
    /** @scenario "offloaded bytes are recorded for storage accounting" */
    it("sums their bytes via getStorageUsageByProject scoped to the purpose", async () => {
      const storedObjects = buildStoredObjects();
      const summed = await storedObjects.getStorageUsageByProject({
        projectId: tenantId,
        purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
      });

      // At least the one object stored by the first test in this file.
      expect(summed.objectCount).toBeGreaterThanOrEqual(1);
      expect(summed.totalBytes).toBeGreaterThan(EVAL_INPUTS_INLINE_MAX_BYTES);

      // Cross-check: the sum equals the raw sum of live rows for the purpose.
      const raw = await ch.query({
        query: `
          SELECT sum(size_bytes) AS total, count() AS cnt
          FROM stored_objects FINAL
          WHERE project_id = {projectId:String} AND purpose = {purpose:String}
        `,
        query_params: {
          projectId: tenantId,
          purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
        },
        format: "JSONEachRow",
      });
      const rawRows = await raw.json<{ total: string | number; cnt: string }>();
      expect(summed.totalBytes).toBe(Number(rawRows[0]!.total));
    });
  });
});
