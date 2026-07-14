/**
 * @vitest-environment node
 *
 * Unit tests for the evaluation-inputs offload decision, marker roundtrip, and
 * resolve fail-safe (ADR-040). Boundaries under test (the size decision and
 * marker shaping) use a fake stored-objects service; only the object-store
 * byte I/O is faked, never the offload logic itself.
 */
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { StoredObjectsService } from "~/server/stored-objects/stored-objects.service";
import {
  EVAL_INPUTS_HARD_CEILING_BYTES,
  EVAL_INPUTS_INLINE_MAX_BYTES,
  EVAL_INPUTS_PREVIEW_BYTES,
  EVAL_INPUTS_STORED_OBJECT_PURPOSE,
  isStoredObjectMarker,
  offloadInputsIfOversized,
  resolveInputsMarker,
  STORED_OBJECT_MARKER_KEY,
} from "../evaluation-inputs-offload";

interface FakeStoredEntry {
  bytes: Buffer;
  purpose: string;
}

/**
 * In-memory stand-in for StoredObjectsService: records what was stored (bytes
 * and purpose) and streams it back on getById with a row carrying that
 * purpose. Only the byte I/O is faked.
 */
function makeFakeStoredObjects(): StoredObjectsService & {
  stored: Map<string, FakeStoredEntry>;
} {
  const stored = new Map<string, FakeStoredEntry>();
  let seq = 0;
  const fake = {
    stored,
    async storeFromBytes({
      bytes,
      purpose,
    }: {
      bytes: Buffer;
      purpose: string;
    }) {
      const id = `so-${++seq}`;
      stored.set(id, { bytes: Buffer.from(bytes), purpose });
      return { id, mediaType: "application/json", isDuplicate: false };
    },
    async getById({ id }: { id: string }) {
      const entry = stored.get(id);
      if (!entry) return null;
      return {
        row: { purpose: entry.purpose } as never,
        stream: Readable.from([entry.bytes]),
      };
    },
  };
  return fake as unknown as StoredObjectsService & {
    stored: Map<string, FakeStoredEntry>;
  };
}

/** Seeds the fake store with raw bytes under a purpose and returns the id. */
function seedObject(
  storedObjects: StoredObjectsService & {
    stored: Map<string, FakeStoredEntry>;
  },
  { bytes, purpose }: { bytes: Buffer; purpose: string },
): string {
  const id = `seed-${storedObjects.stored.size + 1}`;
  storedObjects.stored.set(id, { bytes, purpose });
  return id;
}

/** Builds a resolvable marker referencing the given id/bytes. */
function markerFor({
  id,
  bytes,
  sha256,
}: {
  id: string;
  bytes: Buffer;
  sha256?: string | null;
}) {
  return {
    [STORED_OBJECT_MARKER_KEY]: {
      id,
      sizeBytes: bytes.length,
      sha256:
        sha256 === undefined
          ? createHash("sha256").update(bytes).digest("hex")
          : sha256,
      preview: bytes.toString("utf8").slice(0, 32),
      truncatedPreview: true,
    },
  };
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
    /** @scenario "when the offload PUT fails, the evaluation completes with a bounded preview marker" */
    it("fails open to a bounded preview-only marker, never the raw inputs", async () => {
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

      // The evaluation is not blocked, but the oversized inputs must not
      // travel inline into the event either: the payload degrades to a
      // preview-only marker so event_log stays bounded under an S3 outage.
      expect(result.offloaded).toBe(false);
      expect(isStoredObjectMarker(result.inputs)).toBe(true);
      const marker = (result.inputs as Record<string, any>)[
        STORED_OBJECT_MARKER_KEY
      ];
      expect(marker.offloadFailed).toBe(true);
      expect(marker.id).toBe("");
      expect(marker.sha256).toBeNull();
      expect(marker.sizeBytes).toBe(
        Buffer.byteLength(JSON.stringify(inputs), "utf8"),
      );
      expect(marker.truncatedPreview).toBe(true);
      expect(Buffer.byteLength(marker.preview, "utf8")).toBeLessThanOrEqual(
        EVAL_INPUTS_PREVIEW_BYTES,
      );
      expect(
        Buffer.byteLength(JSON.stringify(result.inputs), "utf8"),
      ).toBeLessThan(EVAL_INPUTS_INLINE_MAX_BYTES);
      // A preview-only marker resolves to itself (nothing durable to fetch).
      const resolved = await resolveInputsMarker({
        inputs: result.inputs,
        projectId: "proj-1",
        storedObjects,
      });
      expect(resolved).toBe(result.inputs);
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
          preview: '{"blob":"xxx',
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
          preview: '{"blob":"xxx',
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

  describe("given a marker resolving to an object of another purpose", () => {
    it("returns the marker with its preview and does not surface foreign bytes", async () => {
      const storedObjects = makeFakeStoredObjects();
      const bytes = Buffer.from(JSON.stringify({ secret: "other-owner" }));
      // Same project, but a trace_content object - not evaluation inputs.
      const id = seedObject(storedObjects, {
        bytes,
        purpose: "trace_content",
      });
      // sha matches so the ONLY reason to reject is the purpose mismatch.
      const marker = markerFor({ id, bytes });

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(marker);
    });
  });

  describe("given a marker whose object bytes fail sha256 verification", () => {
    it("returns the marker with its preview and does not surface the tampered bytes", async () => {
      const storedObjects = makeFakeStoredObjects();
      const bytes = Buffer.from(JSON.stringify({ input: "diverged" }));
      const id = seedObject(storedObjects, {
        bytes,
        purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
      });
      // Correct purpose, but the marker's recorded hash does not match bytes.
      const marker = markerFor({ id, bytes, sha256: "f".repeat(64) });

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(marker);
    });
  });

  describe("given a marker with a non-empty id but no content hash", () => {
    it("returns the marker without fetching the named object", async () => {
      const storedObjects = makeFakeStoredObjects();
      const bytes = Buffer.from(JSON.stringify({ secret: "same-project" }));
      const id = seedObject(storedObjects, {
        bytes,
        purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
      });
      const getById = vi.spyOn(storedObjects, "getById");
      // A marker-shaped input naming a real evaluation-inputs object but
      // omitting the hash: the write path always records one alongside a
      // non-empty id, so this shape only arises malformed or forged. Without
      // the hash there is no proof the bytes are the offloaded content.
      const marker = markerFor({ id, bytes, sha256: null });

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(marker);
      expect(getById).not.toHaveBeenCalled();
    });
  });

  describe("given a marker whose content hash is not a well-formed sha256", () => {
    it("returns the marker without fetching the named object", async () => {
      const storedObjects = makeFakeStoredObjects();
      const bytes = Buffer.from(JSON.stringify({ secret: "same-project" }));
      const id = seedObject(storedObjects, {
        bytes,
        purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
      });
      const getById = vi.spyOn(storedObjects, "getById");
      const marker = markerFor({ id, bytes, sha256: "not-a-hash" });

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toBe(marker);
      expect(getById).not.toHaveBeenCalled();
    });
  });

  describe("given a well-formed marker with matching purpose and hash", () => {
    it("resolves to the full inputs", async () => {
      const storedObjects = makeFakeStoredObjects();
      const inputs = { input: "hello", output: "world", n: [1, 2, 3] };
      const bytes = Buffer.from(JSON.stringify(inputs));
      const id = seedObject(storedObjects, {
        bytes,
        purpose: EVAL_INPUTS_STORED_OBJECT_PURPOSE,
      });
      const marker = markerFor({ id, bytes });

      const resolved = await resolveInputsMarker({
        inputs: marker,
        projectId: "proj-1",
        storedObjects,
      });

      expect(resolved).toEqual(inputs);
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
