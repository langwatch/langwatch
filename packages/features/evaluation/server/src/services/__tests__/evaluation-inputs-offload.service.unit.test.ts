import { describe, expect, it, vi } from "vitest";
import { EvaluationInputStoragePort } from "../../ports/evaluation.port";
import { EvaluationInputsOffloadService } from "../evaluation-inputs-offload.service";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  isStoredObjectMarker,
  STORED_OBJECT_MARKER_KEY,
} from "../evaluation-inputs-offload.service";

class MemoryStorage extends EvaluationInputStoragePort {
  readonly stored = new Map<string, Uint8Array>();
  private sequence = 0;

  async store(input: { bytes: Uint8Array }): Promise<{ id: string }> {
    const id = `so-${++this.sequence}`;
    this.stored.set(id, new Uint8Array(input.bytes));
    return { id };
  }

  async tryRead(input: { id: string }): Promise<AsyncIterable<Uint8Array> | null> {
    const bytes = this.stored.get(input.id);
    if (!bytes) return null;
    return (async function* () {
      yield bytes;
    })();
  }
}

function makeService(storage = new MemoryStorage()): {
  service: EvaluationInputsOffloadService;
  storage: MemoryStorage;
} {
  return {
    service: EvaluationInputsOffloadService.create({
      storage,
      config: {
        inlineMaxBytes: EVAL_INPUTS_INLINE_MAX_BYTES,
        hardCeilingBytes: EVAL_INPUTS_HARD_CEILING_BYTES,
        previewBytes: EVAL_INPUTS_PREVIEW_BYTES,
      },
    }),
    storage,
  };
}

function inputsOfSize(bytes: number): Record<string, unknown> {
  const overhead = JSON.stringify({ blob: "" }).length;
  return { blob: "x".repeat(Math.max(0, bytes - overhead)) };
}

function markerOf(value: Record<string, unknown> | null) {
  if (!isStoredObjectMarker(value)) throw new Error("expected stored object marker");
  return value[STORED_OBJECT_MARKER_KEY];
}

describe("EvaluationInputsOffloadService", () => {
  it("keeps inputs at the inline threshold unchanged", async () => {
    const { service, storage } = makeService();
    const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES);

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    expect(result).toBe(inputs);
    expect(storage.stored).toHaveLength(0);
  });

  it("offloads oversized inputs with a bounded marker and exact bytes", async () => {
    const { service, storage } = makeService();
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
    expect(storage.stored).toHaveLength(1);
    expect(marker.id).toBeTruthy();
    expect(marker.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(marker.sizeBytes).toBe(Buffer.byteLength(JSON.stringify(inputs), "utf8"));
    expect(marker.truncatedPreview).toBe(true);
    expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
      EVAL_INPUTS_PREVIEW_BYTES,
    );

    await expect(service.tryResolve({ tenantId: "project-1", inputs: result })).resolves.toEqual(
      inputs,
    );
  });

  it("uses UTF-8 byte length when deciding whether to offload", async () => {
    const { service } = makeService();
    const inputs = { text: "€".repeat(EVAL_INPUTS_INLINE_MAX_BYTES) };

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    expect(isStoredObjectMarker(result)).toBe(true);
  });

  it("returns a preview-only marker beyond the hard ceiling", async () => {
    const { service, storage } = makeService();
    const inputs = inputsOfSize(EVAL_INPUTS_HARD_CEILING_BYTES + 1024);

    const result = await service.offload({
      tenantId: "project-1",
      evaluationId: "evaluation-1",
      inputs,
    });

    const marker = markerOf(result);
    expect(storage.stored).toHaveLength(0);
    expect(marker.ceilingExceeded).toBe(true);
    expect(marker.id).toBe("");
    expect(marker.sha256).toBeNull();
    expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
      EVAL_INPUTS_PREVIEW_BYTES,
    );
  });

  it("bounds the marker when storage fails", async () => {
    const storage = new MemoryStorage();
    vi.spyOn(storage, "store").mockRejectedValueOnce(new Error("storage unavailable"));
    const { service } = makeService(storage);
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
    await expect(service.tryResolve({ tenantId: "project-1", inputs: result })).resolves.toBe(
      result,
    );
  });

  it("does not double-offload an existing marker", async () => {
    const { service, storage } = makeService();
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
    expect(storage.stored).toHaveLength(0);
  });

  it("returns plain values and missing objects unchanged during resolution", async () => {
    const { service } = makeService();
    const inputs = { answer: "two" };
    const marker = {
      [STORED_OBJECT_MARKER_KEY]: {
        id: "missing",
        sizeBytes: 12,
        sha256: "b".repeat(64),
        preview: '{"answer":',
        truncatedPreview: true,
      },
    };

    await expect(service.tryResolve({ tenantId: "project-1", inputs })).resolves.toBe(inputs);
    await expect(service.tryResolve({ tenantId: "project-1", inputs: marker })).resolves.toBe(
      marker,
    );
  });

  it("does not read preview-only markers", async () => {
    const { service, storage } = makeService();
    const readSpy = vi.spyOn(storage, "tryRead");
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

    await expect(service.tryResolve({ tenantId: "project-1", inputs: marker })).resolves.toBe(
      marker,
    );
    expect(readSpy).not.toHaveBeenCalled();
  });
});
