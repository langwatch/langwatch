/**
 * @vitest-environment node
 *
 * Unit tests for the evaluation-inputs offload decision, marker roundtrip, and
 * resolve fail-safe (ADR-039). Boundaries under test (the size decision and
 * marker shaping) use a fake stored-objects service; only the object-store
 * byte I/O is faked, never the offload logic itself.
 */
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  isStoredObjectMarker,
  offloadInputsIfOversized,
  resolveInputsMarker,
  STORED_OBJECT_MARKER_KEY,
} from "../evaluation-inputs-offload";

/**
 * In-memory stand-in for StoredObjectsService: records what was stored and
 * streams it back on getById. Only the byte I/O is faked.
 */
function makeFakeStoredObjects(): StoredObjectsService & {
  stored: Map<string, Buffer>;
} {
  const stored = new Map<string, Buffer>();
  let seq = 0;
  const fake = {
    stored,
    async storeFromBytes({ bytes }: { bytes: Buffer }) {
      const id = `so-${++seq}`;
      stored.set(id, Buffer.from(bytes));
      return { id, mediaType: "application/json", isDuplicate: false };
    },
    async getById({ id }: { id: string }) {
      const bytes = stored.get(id);
      if (!bytes) return null;
      return { row: {} as never, stream: Readable.from([bytes]) };
    },
  };
  return fake as unknown as StoredObjectsService & { stored: Map<string, Buffer> };
}

/** Builds an inputs object whose JSON serialization is at least `bytes` long. */
function inputsOfSize(bytes: number): Record<string, unknown> {
  // {"blob":"<padding>"} - pad so JSON.stringify length crosses `bytes`.
  const overhead = JSON.stringify({ blob: "" }).length;
  return { blob: "x".repeat(Math.max(0, bytes - overhead)) };
}

describe("offloadInputsIfOversized", () => {
  describe("given inputs at or below the inline threshold", () => {
    it("keeps small inputs inline without storing anything", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = { question: "hi", answer: "there" };

      const result = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });

      expect(result.offloaded).toBe(false);
      expect(result.inputs).toBe(inputs);
      expect(storedObjects.stored.size).toBe(0);
    });

    it("keeps inputs exactly at the inline threshold inline", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES);
      // Guard the fixture: serialization must land at exactly the cap.
      expect(Buffer.byteLength(JSON.stringify(inputs), "utf8")).toBe(
        EVAL_INPUTS_INLINE_MAX_BYTES,
      );

      const result = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });

      expect(result.offloaded).toBe(false);
      expect(storedObjects.stored.size).toBe(0);
    });

    it("passes null and undefined through unchanged", async () => {
      const storedObjects = makeFakeStoredObjects();

      const nullResult = await offloadInputsIfOversized({
        inputs: null,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });
      const undefinedResult = await offloadInputsIfOversized({
        inputs: undefined,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });

      expect(nullResult.inputs).toBeNull();
      expect(nullResult.offloaded).toBe(false);
      expect(undefinedResult.inputs).toBeNull();
      expect(undefinedResult.offloaded).toBe(false);
    });
  });

  describe("given inputs above the inline threshold but under the hard ceiling", () => {
    it("offloads to storage and returns a marker with a bounded preview", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 1024);

      const result = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-1",
        evaluationId: "eval-42",
        storedObjects,
      });

      expect(result.offloaded).toBe(true);
      expect(isStoredObjectMarker(result.inputs)).toBe(true);
      expect(storedObjects.stored.size).toBe(1);

      const marker = (result.inputs as Record<string, any>)[
        STORED_OBJECT_MARKER_KEY
      ];
      expect(marker.id).toBeTruthy();
      expect(marker.sha256).toMatch(/^[0-9a-f]{64}$/);
      expect(marker.sizeBytes).toBe(
        Buffer.byteLength(JSON.stringify(inputs), "utf8"),
      );
      expect(marker.truncatedPreview).toBe(true);
      expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
        EVAL_INPUTS_PREVIEW_BYTES,
      );
      expect(marker.ceilingExceeded).toBeUndefined();
    });

    it("stores the exact serialized bytes so a resolve is byte-identical", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = {
        ...inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 5000),
        nested: { a: 1, b: [1, 2, 3], c: "café" },
      };

      const offload = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });
      const resolved = await resolveInputsMarker({
        inputs: offload.inputs,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toEqual(inputs);
    });
  });

  describe("given multibyte inputs straddling the threshold", () => {
    it("decides on byte length, not code-unit length", async () => {
      const storedObjects = makeFakeStoredObjects();
      // Each "€" is 3 UTF-8 bytes but 1 code unit. Build a payload whose byte
      // length exceeds the cap while its .length (code units) does not.
      const euros = "€".repeat(EVAL_INPUTS_INLINE_MAX_BYTES); // ~3x cap bytes
      const inputs = { text: euros };
      expect(euros.length).toBeLessThan(EVAL_INPUTS_INLINE_MAX_BYTES * 3 + 1);

      const result = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });

      expect(result.offloaded).toBe(true);
      expect(isStoredObjectMarker(result.inputs)).toBe(true);
    });
  });

  describe("given inputs beyond the hard ceiling", () => {
    it("stores a preview-only marker and does not offload the full content", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = inputsOfSize(EVAL_INPUTS_HARD_CEILING_BYTES + 1024);

      const result = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-9",
        evaluationId: "eval-huge",
        storedObjects,
      });

      expect(result.offloaded).toBe(false);
      expect(storedObjects.stored.size).toBe(0);
      expect(isStoredObjectMarker(result.inputs)).toBe(true);
      const marker = (result.inputs as Record<string, any>)[
        STORED_OBJECT_MARKER_KEY
      ];
      expect(marker.ceilingExceeded).toBe(true);
      expect(marker.id).toBe("");
      expect(marker.sha256).toBeNull();
      expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
        EVAL_INPUTS_PREVIEW_BYTES,
      );
    });
  });

  describe("given the storage PUT fails", () => {
    /** @scenario "when the offload PUT fails, the inputs stay inline and the evaluation still completes" */
    it("fails open by keeping inputs inline", async () => {
      const storedObjects = makeFakeStoredObjects();
      vi.spyOn(storedObjects, "storeFromBytes").mockRejectedValueOnce(
        new Error("s3 down"),
      );
      const inputs = inputsOfSize(EVAL_INPUTS_INLINE_MAX_BYTES + 2048);

      const result = await offloadInputsIfOversized({
        inputs,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });

      expect(result.offloaded).toBe(false);
      expect(result.inputs).toBe(inputs);
      expect(isStoredObjectMarker(result.inputs)).toBe(false);
    });
  });

  describe("given inputs that are already a marker", () => {
    it("passes the marker through without double-offloading", async () => {
      const storedObjects = makeFakeStoredObjects();
      const marker = {
        [STORED_OBJECT_MARKER_KEY]: {
          id: "so-existing",
          sizeBytes: 999,
          sha256: "a".repeat(64),
          preview: "{...}",
          truncatedPreview: true,
        },
      };

      const result = await offloadInputsIfOversized({
        inputs: marker,
        projectId: "proj-1",
        evaluationId: "eval-1",
        storedObjects,
      });

      expect(result.offloaded).toBe(false);
      expect(result.inputs).toBe(marker);
      expect(storedObjects.stored.size).toBe(0);
    });
  });
});

describe("resolveInputsMarker", () => {
  describe("given a non-marker value", () => {
    it("returns plain inputs unchanged", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = { a: 1, b: "two" };

      const resolved = await resolveInputsMarker({
        inputs,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(inputs);
    });

    it("passes null through", async () => {
      const storedObjects = makeFakeStoredObjects();
      const resolved = await resolveInputsMarker({
        inputs: null,
        projectId: "proj-1",
        storedObjects,
      });
      expect(resolved).toBeNull();
    });
  });

  describe("given a marker whose object is missing", () => {
    it("returns the marker with its preview and does not throw", async () => {
      const storedObjects = makeFakeStoredObjects();
      const marker = {
        [STORED_OBJECT_MARKER_KEY]: {
          id: "so-gone",
          sizeBytes: 123,
          sha256: "b".repeat(64),
          preview: "{\"blob\":\"xxx",
          truncatedPreview: true,
        },
      };

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(marker);
    });
  });

  describe("given a hard-ceiling marker", () => {
    it("returns the marker untouched (no durable object to fetch)", async () => {
      const storedObjects = makeFakeStoredObjects();
      const getSpy = vi.spyOn(storedObjects, "getById");
      const marker = {
        [STORED_OBJECT_MARKER_KEY]: {
          id: "",
          sizeBytes: EVAL_INPUTS_HARD_CEILING_BYTES + 1,
          sha256: null,
          preview: "{\"blob\":\"xxx",
          truncatedPreview: true,
          ceilingExceeded: true,
        },
      };

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(marker);
      expect(getSpy).not.toHaveBeenCalled();
    });
  });
});

describe("isStoredObjectMarker", () => {
  it("distinguishes markers from plain objects, arrays, and primitives", () => {
    expect(
      isStoredObjectMarker({ [STORED_OBJECT_MARKER_KEY]: { id: "x" } }),
    ).toBe(true);
    expect(isStoredObjectMarker({ some: "inputs" })).toBe(false);
    expect(isStoredObjectMarker([1, 2, 3])).toBe(false);
    expect(isStoredObjectMarker(null)).toBe(false);
    expect(isStoredObjectMarker("string")).toBe(false);
    expect(isStoredObjectMarker(42)).toBe(false);
  });
});
