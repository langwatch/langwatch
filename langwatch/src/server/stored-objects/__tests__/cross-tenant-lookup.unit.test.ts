/**
 * Cross-tenant stored-object owner lookup — unit tests.
 *
 * Verifies the fan-out across all configured ClickHouse instances so the
 * `/api/files/:id` route resolves objects owned by tenants routed to a
 * private CH instance. Pre-fix the lookup only queried the shared client,
 * which 404'd for any object owned by a private-CH tenant (Sergio review).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { resolveStoredObjectOwner } from "../stored-objects-cross-tenant-lookup";

const mockGetAllInstances = vi.fn();

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getAllClickHouseInstances: () => mockGetAllInstances(),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: async <T>(
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: () => void }) => Promise<T>,
    ) => fn({ setAttribute: () => undefined }),
  }),
}));

function makeMockClient(rows: { project_id: string }[]) {
  return {
    query: vi.fn().mockResolvedValue({
      json: vi.fn().mockResolvedValue(rows),
    }),
  };
}

describe("resolveStoredObjectOwner", () => {
  beforeEach(() => {
    mockGetAllInstances.mockReset();
  });

  describe("when only the shared instance is configured", () => {
    it("finds the row in the shared instance", async () => {
      mockGetAllInstances.mockResolvedValue([
        { target: "shared", client: makeMockClient([{ project_id: "proj_a" }]) },
      ]);

      const owner = await resolveStoredObjectOwner({ id: "obj-1" });

      expect(owner).toEqual({ projectId: "proj_a" });
    });

    it("returns null when the row is not in any instance", async () => {
      mockGetAllInstances.mockResolvedValue([
        { target: "shared", client: makeMockClient([]) },
      ]);

      const owner = await resolveStoredObjectOwner({ id: "missing" });

      expect(owner).toBeNull();
    });
  });

  describe("when a private-CH tenant owns the row", () => {
    /** @scenario "Cross-tenant owner lookup fans out to every ClickHouse instance" */
    it("finds the row in the private instance even though shared has no match", async () => {
      mockGetAllInstances.mockResolvedValue([
        { target: "shared", client: makeMockClient([]) },
        { target: "org_byoc", client: makeMockClient([{ project_id: "proj_byoc" }]) },
      ]);

      const owner = await resolveStoredObjectOwner({ id: "obj-byoc" });

      expect(owner).toEqual({ projectId: "proj_byoc" });
    });
  });

  describe("when multiple instances are configured but the row exists in none", () => {
    it("returns null after fanning out to all of them", async () => {
      const sharedClient = makeMockClient([]);
      const privateClient = makeMockClient([]);
      mockGetAllInstances.mockResolvedValue([
        { target: "shared", client: sharedClient },
        { target: "org_byoc", client: privateClient },
      ]);

      const owner = await resolveStoredObjectOwner({ id: "unknown" });

      expect(owner).toBeNull();
      expect(sharedClient.query).toHaveBeenCalledTimes(1);
      expect(privateClient.query).toHaveBeenCalledTimes(1);
    });
  });

  describe("when no ClickHouse instance is configured", () => {
    it("throws a descriptive error", async () => {
      mockGetAllInstances.mockResolvedValue([]);

      await expect(
        resolveStoredObjectOwner({ id: "obj-1" }),
      ).rejects.toThrow(/ClickHouse is not configured/);
    });
  });
});
