/**
 * The spans the stored-object byte paths open.
 * @vitest-environment node
 */
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const spanNames = vi.hoisted(() => [] as string[]);

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (name: string, ...args: unknown[]) => {
      spanNames.push(name);
      const fn = args.length === 1 ? args[0] : args[1];
      return (fn as (span: { setAttribute: () => void }) => Promise<unknown>)({
        setAttribute: () => undefined,
      });
    },
  }),
}));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import type { StoredObjectStoragePort } from "../../ports/stored-object-storage.port";
import type { StoredObject } from "../../repositories/stored-objects.row";
import type { StoredObjectsRepository } from "../../repositories/stored-objects.repository";
import type { StoredObjectsTelemetryPort } from "../../ports/stored-objects-telemetry.port";
import { StoredObjectsService } from "../stored-objects.service";

const PROJECT_ID = "proj-1";

const row: StoredObject = {
  id: "obj-1",
  project_id: PROJECT_ID,
  purpose: "scenario_event",
  owner_kind: "scenario_run",
  owner_id: "run-1",
  media_type: "audio/wav",
  size_bytes: 5,
  sha256: "abc123",
  storage_uri: `file:///var/lib/langwatch/objects/${PROJECT_ID}/abc123`,
  created_at: new Date("2026-01-01T00:00:00Z"),
  inserted_at: new Date("2026-01-01T00:00:00Z"),
};

function makeService(): StoredObjectsService {
  return StoredObjectsService.create({
    repository: {
      insert: vi.fn(async () => undefined),
      findById: vi.fn(async () => row),
      findAllByProject: vi.fn(async () => []),
      deleteByProject: vi.fn(async () => undefined),
      deleteByIds: vi.fn(async () => undefined),
    } as unknown as StoredObjectsRepository,
    registry: {
      get: vi.fn(async () => Readable.from([Buffer.from("bytes")])),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      exists: vi.fn(async () => true),
    } as unknown as StoredObjectStoragePort,
    mintStorageUri: async ({ projectId, sha256 }) => `file:///tmp/${projectId}/${sha256}`,
    telemetry: {
      recordExtract: vi.fn(),
      recordDedupHit: vi.fn(),
      recordWriteFailure: vi.fn(),
      recordReadFailure: vi.fn(),
      observeSizeBytes: vi.fn(),
    } as unknown as StoredObjectsTelemetryPort,
  });
}

beforeEach(() => {
  spanNames.length = 0;
});

describe("StoredObjectsService tracing", () => {
  describe("when bytes are externalized during ingest", () => {
    /** @scenario "OpenTelemetry spans wrap extraction during ingest and reads via /api/files/:id" */
    it("opens a span named for the extraction", async () => {
      await makeService().storeFromBytes({
        projectId: PROJECT_ID,
        purpose: "scenario_event",
        ownerKind: "scenario_run",
        ownerId: "run-1",
        mediaType: "audio/wav",
        bytes: Buffer.from("bytes"),
      });

      expect(spanNames).toContain("StoredObjectsService.storeFromBytes");
    });
  });

  describe("when the file surface reads an object back", () => {
    /** @scenario "OpenTelemetry spans wrap extraction during ingest and reads via /api/files/:id" */
    it("opens a span named for the read", async () => {
      await makeService().getById({ projectId: PROJECT_ID, id: "obj-1" });

      expect(spanNames).toContain("StoredObjectsService.getById");
    });
  });
});
