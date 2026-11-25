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

import type { StoredObject } from "../../rules/stored-object-row.rules.ts";
import { StoredObjectsService } from "../stored-objects.service.ts";

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
    repository: { tryFindById: vi.fn(async () => row) },
    registry: {
      get: vi.fn(async () => Readable.from([Buffer.from("bytes")])),
      put: vi.fn(async () => undefined),
      delete: vi.fn(async () => undefined),
      exists: vi.fn(async () => true),
    },
    telemetry: { recordReadFailure: vi.fn() },
  });
}

beforeEach(() => {
  spanNames.length = 0;
});

describe("StoredObjectsService tracing", () => {
  describe("when the file surface reads an object back", () => {
    /** @scenario "OpenTelemetry spans wrap reads via /api/files/:id" */
    it("opens a span named for the read", async () => {
      await makeService().getById({ projectId: PROJECT_ID, id: "obj-1" });

      expect(spanNames).toContain("StoredObjectsService.getById");
    });
  });
});
