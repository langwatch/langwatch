import { beforeEach, describe, expect, it, vi } from "vitest";

const { getAllClickHouseInstances, withActiveSpan } = vi.hoisted(() => ({
  getAllClickHouseInstances: vi.fn(),
  withActiveSpan: vi.fn(),
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({ withActiveSpan }),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getAllClickHouseInstances,
}));

import { AppStoredObjectOwnerInstanceDirectory } from "../stored-object-owner-instance-directory.adapter";
import { AppStoredObjectOwnerLookupTracingAdapter } from "../stored-object-owner-lookup.tracing.adapter";

describe("AppStoredObjectOwnerLookupTracingAdapter", () => {
  beforeEach(() => {
    getAllClickHouseInstances.mockReset();
    withActiveSpan.mockReset();
  });

  it("lists every process-composed ClickHouse instance through the named directory", async () => {
    const instances = [{ target: "shared", client: { query: vi.fn() } }];
    getAllClickHouseInstances.mockResolvedValue(instances);

    await expect(AppStoredObjectOwnerInstanceDirectory.create().listInstances()).resolves.toEqual(
      instances,
    );
    expect(getAllClickHouseInstances).toHaveBeenCalledOnce();
  });

  it("keeps the test application owner lookup unavailable", async () => {
    await expect(
      AppStoredObjectOwnerInstanceDirectory.createUnavailableForTests().listInstances(),
    ).resolves.toEqual([]);
    expect(getAllClickHouseInstances).not.toHaveBeenCalled();
  });

  it("preserves the legacy owner-lookup span name and database attributes", async () => {
    withActiveSpan.mockImplementation(
      async (
        _name: string,
        _options: unknown,
        operation: (span: { setAttribute: () => void }) => Promise<string>,
      ) => await operation({ setAttribute: () => undefined }),
    );
    const adapter = AppStoredObjectOwnerLookupTracingAdapter.create();

    await expect(adapter.withLookupSpan({ id: "obj_1" }, async () => "completed")).resolves.toBe(
      "completed",
    );

    expect(withActiveSpan).toHaveBeenCalledWith(
      "StoredObjects.resolveStoredObjectOwner",
      expect.objectContaining({
        attributes: {
          "db.system": "clickhouse",
          "db.operation": "SELECT",
          "stored_object.id": "obj_1",
        },
      }),
      expect.any(Function),
    );
  });
});
