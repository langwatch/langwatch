import type * as Observability from "@langwatch/observability";
import { memoryObjectStorage } from "@langwatch/process-stores";
import type { ObjectStorage } from "@langwatch/process-stores/members";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { EvaluationRetentionLookup } from "../../repositories/evaluation.repository.ts";
import { ObjectStorageEvaluationInputRepository } from "../../repositories/object-storage/object-storage.evaluation-input.repository.ts";
import { legacyEvaluationInputKey } from "../../rules/evaluation-input-object.rules.ts";
import {
  EvaluationInputsOffloadService,
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  STORED_OBJECT_MARKER_KEY,
} from "../evaluation-inputs-offload.service.ts";

const warnings = vi.hoisted(() => [] as { fields: Record<string, unknown>; message: string }[]);

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof Observability>()),
  createLogger: () => ({
    warn: (fields: Record<string, unknown>, message: string) => warnings.push({ fields, message }),
    info: () => undefined,
    debug: () => undefined,
    error: () => undefined,
  }),
}));

beforeEach(() => {
  warnings.length = 0;
});

function retentionOf(days: number | null): EvaluationRetentionLookup {
  return {
    getPlatformDefaultRetentionDays: () => 90,
    findRetentionDays: async () => (days === null ? [] : [days]),
  };
}

function makeService({
  objectStorage = memoryObjectStorage(),
  retentionDays = 90,
}: { objectStorage?: ObjectStorage; retentionDays?: number | null } = {}) {
  return {
    objectStorage,
    service: EvaluationInputsOffloadService.create({
      storage: ObjectStorageEvaluationInputRepository.create({ objectStorage }),
      retention: retentionOf(retentionDays),
      config: {
        inlineMaxBytes: EVAL_INPUTS_INLINE_MAX_BYTES,
        hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
        previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
      },
    }),
  };
}

function inputsOfSize(bytes: number): Record<string, unknown> {
  const overhead = JSON.stringify({ blob: "" }).length;
  return { blob: "x".repeat(Math.max(0, bytes - overhead)) };
}

function markerOf(value: Record<string, unknown> | null) {
  if (!EvaluationInputsOffloadService.isStoredObjectMarker(value))
    throw new Error("expected stored object marker");
  return value[STORED_OBJECT_MARKER_KEY];
}

async function textOf(objects: ObjectStorage, key: string): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of await objects.read({ projectId: "project-1", key })) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

describe("EvaluationInputsOffloadService", () => {
  it("keeps inputs at the inline threshold unchanged", async () => {
    const { service, objectStorage } = makeService();
    const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES);
    const write = vi.spyOn(objectStorage, "write");

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    expect(result).toBe(inputs);
    expect(write).not.toHaveBeenCalled();
  });

  /** @scenario an oversized evaluation input is offloaded, not truncated */
  it("offloads oversized inputs under the evaluation-inputs prefix with a bounded marker and exact bytes", async () => {
    const { service, objectStorage } = makeService();
    const inputs = {
      ...inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024),
      nested: { message: "café" },
    };

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    const marker = markerOf(result);
    expect(marker.key).toBe(`evaluation-inputs/r90/project-1/${marker.sha256}.json`);
    expect(marker.id).toBe(marker.sha256);
    expect(marker.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(inputs), "utf8"));
    expect(marker.truncatedPreview).toBe(true);
    expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
      EVAL_INPUTS_PREVIEW_BYTES,
    );
    expect(await textOf(objectStorage, marker.key ?? "")).toBe(JSON.stringify(inputs));
    expect(JSON.stringify(result)).not.toContain("café");
  });

  /** @scenario evaluation events stay bounded in the event log */
  it("keeps the event payload to the preview and the reference", async () => {
    const { service } = makeService();

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs: inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES * 4),
    });

    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
      EVAL_INPUTS_PREVIEW_BYTES * 2,
    );
    expect(markerOf(result).key).toBeTruthy();
  });

  /** @scenario reading an offloaded evaluation run returns the full inputs */
  it("resolves a marker back to byte-identical inputs", async () => {
    const { service } = makeService();
    const inputs = { ...inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024), note: "café" };

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    await expect(service.resolveInputs({ tenantId: "project-1", inputs: result })).resolves.toEqual(
      inputs,
    );
    await expect(service.resolveInputs({ tenantId: "project-1", inputs })).resolves.toBe(inputs);
  });

  /** @scenario the offload key is derived from the content and recorded in the marker */
  it("writes byte-identical inputs from two runs to one key, recorded in each marker", async () => {
    const { service } = makeService();
    const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024);

    const first = markerOf(
      await service.offload({ tenantId: "project-1", evaluationId: "evaluation-1", inputs }),
    );
    const second = markerOf(
      await service.offload({ tenantId: "project-1", evaluationId: "evaluation-2", inputs }),
    );

    expect(first.key).toBeTruthy();
    expect(second.key).toBe(first.key);
  });

  /** @scenario the offload key carries the retention class in force when it was written */
  it.each([
    [90, "r90"],
    [180, "r180"],
    [400, "r730"],
    [0, "r-indefinite"],
    [null, "r90"],
  ])(
    "writes a project with %s days of retention under %s",
    async (retentionDays, retentionClass) => {
      const { service } = makeService({ retentionDays });

      const marker = markerOf(
        await service.offload({
          tenantId: "project-1",
          evaluationId: "evaluation-1",
          inputs: inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024),
        }),
      );

      expect(marker.key).toBe(
        `evaluation-inputs/${retentionClass}/project-1/${marker.sha256}.json`,
      );
    },
  );

  /** @scenario the offload key carries the retention class in force when it was written */
  it("still reads an object after the project's retention changed", async () => {
    const objectStorage = memoryObjectStorage();
    const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024);
    const written = await makeService({ objectStorage, retentionDays: 90 }).service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    const later = makeService({ objectStorage, retentionDays: 730 }).service;

    expect(markerOf(written).key).toContain("/r90/");
    await expect(later.resolveInputs({ tenantId: "project-1", inputs: written })).resolves.toEqual(
      inputs,
    );
  });

  /** @scenario a run offloaded before the move is read from its old address */
  it("reads a main-era marker at the project's old address built from its content hash", async () => {
    const { service, objectStorage } = makeService();
    const inputs = { answer: "two" };
    const bytes = Buffer.from(JSON.stringify(inputs), "utf8");
    const sha256 = "d".repeat(64);
    await objectStorage.write(
      { projectId: "project-1", key: legacyEvaluationInputKey({ tenantId: "project-1", sha256 }) },
      (async function* () {
        yield bytes;
      })(),
      { byteLength: bytes.byteLength, contentType: "application/json" },
    );
    const mainEraMarker = {
      [STORED_OBJECT_MARKER_KEY]: {
        id: "so_01HZ0000000000000000000000",
        sizeBytes: bytes.byteLength,
        sha256,
        preview: '{"answer":',
        truncatedPreview: true,
      },
    };

    await expect(
      service.resolveInputs({ tenantId: "project-1", inputs: mainEraMarker }),
    ).resolves.toEqual(inputs);
  });

  /** @scenario an expired offload answers its preview and warns */
  it("answers the marker with its preview and warns when the object is gone", async () => {
    const { service } = makeService();
    const marker = {
      [STORED_OBJECT_MARKER_KEY]: {
        id: "e".repeat(64),
        key: `evaluation-inputs/r90/project-1/${"e".repeat(64)}.json`,
        sizeBytes: 12,
        sha256: "e".repeat(64),
        preview: '{"answer":',
        truncatedPreview: true,
      },
    };

    await expect(service.resolveInputs({ tenantId: "project-1", inputs: marker })).resolves.toBe(
      marker,
    );
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.fields).toMatchObject({
      tenantId: "project-1",
      objectKey: marker[STORED_OBJECT_MARKER_KEY].key,
    });
  });

  /** @scenario a marker that names another project's object is never read */
  it("does not read an object a marker names under another project", async () => {
    const { service, objectStorage } = makeService();
    const read = vi.spyOn(objectStorage, "read");
    const marker = {
      [STORED_OBJECT_MARKER_KEY]: {
        id: "f".repeat(64),
        key: `evaluation-inputs/r90/project-2/${"f".repeat(64)}.json`,
        sizeBytes: 12,
        sha256: "f".repeat(64),
        preview: '{"answer":',
        truncatedPreview: true,
      },
    };

    await expect(service.resolveInputs({ tenantId: "project-1", inputs: marker })).resolves.toBe(
      marker,
    );
    expect(read).not.toHaveBeenCalled();
  });

  /** @scenario inputs beyond the hard ceiling are bounded with an observable marker */
  it("returns a preview-only marker beyond the hard ceiling and warns", async () => {
    const { service, objectStorage } = makeService();
    const write = vi.spyOn(objectStorage, "write");
    const inputs = inputsOfSize(EVAL_INPUTS_HARD_CEILING_BYTES + 1024);

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    const marker = markerOf(result);
    expect(write).not.toHaveBeenCalled();
    expect(marker.ceilingExceeded).toBe(true);
    expect(marker.id).toBe("");
    expect(marker.sha256).toBeNull();
    expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
      EVAL_INPUTS_PREVIEW_BYTES,
    );
    expect(warnings[0]?.fields).toMatchObject({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
    });
  });

  /** @scenario when the offload PUT fails, the evaluation completes with a bounded preview marker */
  it("bounds the marker and warns when storage fails", async () => {
    const objectStorage = memoryObjectStorage();
    vi.spyOn(objectStorage, "write").mockRejectedValueOnce(new Error("storage unavailable"));
    const { service } = makeService({ objectStorage });
    const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024);

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    const marker = markerOf(result);
    expect(marker.offloadFailed).toBe(true);
    expect(marker.id).toBe("");
    expect(marker.sha256).toBeNull();
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBeLessThan(
      EVAL_INPUTS_INLINE_MAX_BYTES,
    );
    expect(warnings[0]?.fields).toMatchObject({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
    });
    await expect(service.resolveInputs({ tenantId: "project-1", inputs: result })).resolves.toBe(
      result,
    );
  });

  /** @scenario a filesystem destination keeps the inputs as a preview marker */
  it("writes no object and answers a preview-only marker on a filesystem destination", async () => {
    const objectStorage: ObjectStorage = {
      ...memoryObjectStorage(),
      destination: async () => ({ kind: "file", root: "/var/lib/langwatch" }),
    };
    const write = vi.spyOn(objectStorage, "write");
    const { service } = makeService({ objectStorage });

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs: inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024),
    });

    expect(write).not.toHaveBeenCalled();
    expect(markerOf(result).offloadFailed).toBe(true);
    expect(markerOf(result).id).toBe("");
  });

  it("does not double-offload an existing marker", async () => {
    const { service, objectStorage } = makeService();
    const write = vi.spyOn(objectStorage, "write");
    const marker = {
      [STORED_OBJECT_MARKER_KEY]: {
        id: "so-existing",
        sizeBytes: 999,
        sha256: "a".repeat(64),
        preview: "{...}",
        truncatedPreview: true,
      },
    };

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs: marker,
    });

    expect(result).toBe(marker);
    expect(write).not.toHaveBeenCalled();
  });

  it("returns plain values unchanged during resolution", async () => {
    const { service } = makeService();
    const inputs = { answer: "two" };

    await expect(service.resolveInputs({ tenantId: "project-1", inputs })).resolves.toBe(inputs);
  });

  it("does not read preview-only markers", async () => {
    const { service, objectStorage } = makeService();
    const read = vi.spyOn(objectStorage, "read");
    const marker = {
      [STORED_OBJECT_MARKER_KEY]: {
        id: "",
        sizeBytes: EVAL_INPUTS_HARD_CEILING_BYTES + 1,
        sha256: null,
        preview: '{"blob":',
        truncatedPreview: true,
        ceilingExceeded: true,
      },
    };

    await expect(service.resolveInputs({ tenantId: "project-1", inputs: marker })).resolves.toBe(
      marker,
    );
    expect(read).not.toHaveBeenCalled();
  });
});
