/**
 * @vitest-environment node
 * @integration
 *
 * Integration test for the storage-accounting byte ledger (ADR-040):
 * StoredObjectsService.getStorageUsageByProject sums size_bytes of a project's
 * live objects, deduped across ReplacingMergeTree versions and optionally
 * scoped to one purpose. Real ClickHouse + LocalFilesystemDriver; only
 * getClickHouseClientForProject is wired to the test client.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as clickhouseClientModule from "~/server/clickhouse/clickhouseClient";
import { getTestClickHouseClient } from "../../event-sourcing/__tests__/integration/testContainers";
import { LocalFilesystemDriver } from "../local-filesystem-driver";
import { StorageRegistry } from "../storage-registry";
import { StoredObjectsRepository } from "../stored-objects.repository";
import type { MintStorageUri } from "../stored-objects.service";
import { StoredObjectsService } from "../stored-objects.service";
import { mintFileUri } from "../uri";

vi.mock("~/server/clickhouse/clickhouseClient", async () => {
  const actual = await vi.importActual<typeof clickhouseClientModule>(
    "~/server/clickhouse/clickhouseClient",
  );
  return {
    ...actual,
    getClickHouseClientForProject: vi.fn(),
  };
});

const projectId = `test-so-usage-${nanoid()}`;

let ch: ClickHouseClient;
let tmpDir: string;

function buildService(): StoredObjectsService {
  const driver = new LocalFilesystemDriver();
  const registry = new StorageRegistry({ file: driver, s3: driver });
  const repository = new StoredObjectsRepository();
  const mintUri: MintStorageUri = async ({ projectId: pid, sha256 }) =>
    mintFileUri({ root: tmpDir, projectId: pid, sha256 });
  return new StoredObjectsService(repository, registry, mintUri);
}

async function waitForRow(id: string, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await ch.query({
      query: `SELECT id FROM stored_objects WHERE project_id = {projectId:String} AND id = {id:String} LIMIT 1`,
      query_params: { projectId, id },
      format: "JSONEachRow",
    });
    if ((await r.json<{ id: string }>()).length > 0) return;
    await new Promise((res) => setTimeout(res, 200));
  }
  throw new Error(`row ${id} never became visible`);
}

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("ClickHouse test container not available");
  ch = client;
  vi.mocked(
    clickhouseClientModule.getClickHouseClientForProject,
  ).mockResolvedValue(ch);
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "so-usage-int-"));
}, 120_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE stored_objects DELETE WHERE project_id = {projectId:String}`,
      query_params: { projectId },
    });
  }
  if (tmpDir) await fs.rm(tmpDir, { recursive: true, force: true });
});

describe("StoredObjectsService.getStorageUsageByProject (integration)", () => {
  describe("given objects of two purposes stored for a project", () => {
    it("sums bytes for the whole project and scoped to one purpose, deduping content", async () => {
      const service = buildService();
      const evalBytes = Buffer.from("e".repeat(5000), "utf8");
      const otherBytes = Buffer.from("o".repeat(3000), "utf8");

      const evalObj = await service.storeFromBytes({
        projectId,
        purpose: "evaluation_inputs",
        ownerKind: "evaluation",
        ownerId: `eval-${nanoid(6)}`,
        mediaType: "application/json",
        bytes: evalBytes,
      });
      const otherObj = await service.storeFromBytes({
        projectId,
        purpose: "scenario_event",
        ownerKind: "scenario_run",
        ownerId: `run-${nanoid(6)}`,
        mediaType: "text/plain",
        bytes: otherBytes,
      });
      await waitForRow(evalObj.id);
      await waitForRow(otherObj.id);

      // Re-store the same eval content: content-addressed dedup means the sum
      // must NOT double-count it.
      const dup = await service.storeFromBytes({
        projectId,
        purpose: "evaluation_inputs",
        ownerKind: "evaluation",
        ownerId: `eval-${nanoid(6)}`,
        mediaType: "application/json",
        bytes: evalBytes,
      });
      expect(dup.id).toBe(evalObj.id);

      const all = await service.getStorageUsageByProject({ projectId });
      expect(all.objectCount).toBe(2);
      expect(all.totalBytes).toBe(evalBytes.length + otherBytes.length);

      const evalOnly = await service.getStorageUsageByProject({
        projectId,
        purpose: "evaluation_inputs",
      });
      expect(evalOnly.objectCount).toBe(1);
      expect(evalOnly.totalBytes).toBe(evalBytes.length);
    });
  });

  describe("given a project with no stored objects", () => {
    it("returns zero bytes and zero objects", async () => {
      const service = buildService();
      const usage = await service.getStorageUsageByProject({
        projectId: `test-so-usage-empty-${nanoid()}`,
      });
      expect(usage.totalBytes).toBe(0);
      expect(usage.objectCount).toBe(0);
    });
  });
});
