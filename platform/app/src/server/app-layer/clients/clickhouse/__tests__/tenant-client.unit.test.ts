import {
  type ClickHouseClient,
  createClickHouseClient,
} from "@langwatch/clickhouse";
import { describe, expect, it, vi } from "vitest";
import {
  QueryMemoryExceededError,
  QueryTimeoutError,
} from "~/server/app-layer/traces/errors";
import { tenantClickHouseClient } from "../tenant-client";

function fakeClient(
  overrides: Partial<ClickHouseClient> = {},
): ClickHouseClient {
  return {
    query: vi.fn().mockResolvedValue({ rows: [], header: undefined }),
    stream: vi.fn(),
    insert: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as unknown as ClickHouseClient;
}

function memoryLimitError(): Error {
  const error = new Error("Memory limit (total) exceeded") as Error & {
    code: string;
  };
  error.code = "241";
  return error;
}

function timeoutExceededError(): Error {
  const error = new Error("TIMEOUT_EXCEEDED") as Error & { code: string };
  error.code = "159";
  return error;
}

describe("given a tenant ClickHouse client", () => {
  describe("when a query runs", () => {
    it("sends the caller's tenant id rather than taking one per call", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.query({ sql: "SELECT 1" });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project-1", sql: "SELECT 1" }),
      );
    });

    it("carries the spill-to-disk and date-parsing settings the driver clients set at construction", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.query({ sql: "SELECT 1" });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: {
            max_bytes_before_external_group_by: 500_000_000,
            date_time_input_format: "best_effort",
          },
        }),
      );
    });

    it("lets a caller override a default setting without losing the others", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.query({
        sql: "SELECT 1",
        settings: { max_bytes_before_external_group_by: 1 },
      });

      expect(client.query).toHaveBeenCalledWith(
        expect.objectContaining({
          settings: {
            max_bytes_before_external_group_by: 1,
            date_time_input_format: "best_effort",
          },
        }),
      );
    });

    it("returns named rows rather than the positional wire result", async () => {
      const client = fakeClient({
        query: vi.fn().mockResolvedValue({
          header: { names: ["TenantId", "Total"], types: ["String", "UInt64"] },
          rows: [["project-1", "3"]],
        }),
      });
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      const rows = await tenant.query<{ TenantId: string; Total: number }>({
        sql: "SELECT TenantId, count() AS Total FROM t",
      });

      expect(rows).toEqual([{ TenantId: "project-1", Total: 3 }]);
    });
  });

  describe("when a query fails with a memory limit", () => {
    it("translates it into the handled error the caller can act on", async () => {
      const client = fakeClient({
        query: vi.fn().mockRejectedValue(memoryLimitError()),
      });
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await expect(tenant.query({ sql: "SELECT 1" })).rejects.toBeInstanceOf(
        QueryMemoryExceededError,
      );
    });
  });

  describe("when the client wraps the driver's error before it reaches us", () => {
    /**
     * The package client never rethrows the driver's error directly — it wraps
     * it in a `ClickHouseOperationError` carrying the query id and tenant, with
     * the original on `cause`. The discriminating `code` lives on that cause,
     * so a translation reading only the outer error matches nothing and every
     * memory limit degrades to a generic unknown error.
     *
     * This runs the real client against a transport that throws, rather than
     * asserting on the translator in isolation, because the wrapping is done by
     * the client and only an end-to-end path proves the two agree.
     */
    it("still recognises a memory limit through the wrapper", async () => {
      const transport = {
        query: vi.fn().mockRejectedValue(memoryLimitError()),
        stream: vi.fn(),
        insert: vi.fn(),
        command: vi.fn(),
        close: vi.fn(),
      };
      const tenant = tenantClickHouseClient({
        client: createClickHouseClient({ url: "http://ch", transport }),
        tenantId: "project-1",
      });

      await expect(tenant.query({ sql: "SELECT 1" })).rejects.toBeInstanceOf(
        QueryMemoryExceededError,
      );
    });
  });

  describe("when a query fails with a server-side timeout", () => {
    it("translates it into the handled timeout error", async () => {
      const client = fakeClient({
        query: vi.fn().mockRejectedValue(timeoutExceededError()),
      });
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await expect(tenant.query({ sql: "SELECT 1" })).rejects.toBeInstanceOf(
        QueryTimeoutError,
      );
    });
  });

  describe("when an insert runs", () => {
    it("flattens object rows into the positional wire shape", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.insert({
        table: "traces",
        target: { kind: "replacing" },
        rows: [
          { TenantId: "project-1", TraceId: "a" },
          { TenantId: "project-1", TraceId: "b" },
        ],
      });

      expect(client.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          table: "traces",
          columns: ["TenantId", "TraceId"],
          rows: [
            ["project-1", "a"],
            ["project-1", "b"],
          ],
        }),
      );
    });

    it("takes the union of the rows' keys so an optional field on a later row still lands", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.insert({
        table: "traces",
        target: { kind: "replacing" },
        rows: [{ TraceId: "a" }, { TraceId: "b", Note: "late" }],
      });

      expect(client.insert).toHaveBeenCalledWith(
        expect.objectContaining({
          columns: ["TraceId", "Note"],
          rows: [
            ["a", null],
            ["b", "late"],
          ],
        }),
      );
    });

    it("declares the write target so the client can decide retryability", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.insert({
        table: "rollups",
        target: { kind: "aggregating" },
        rows: [{ Value: 1 }],
      });

      expect(client.insert).toHaveBeenCalledWith(
        expect.objectContaining({ target: { kind: "aggregating" } }),
      );
    });

    it("skips the client entirely for an empty batch", async () => {
      const client = fakeClient();
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await tenant.insert({
        table: "traces",
        target: { kind: "replacing" },
        rows: [],
      });

      expect(client.insert).not.toHaveBeenCalled();
    });

    it("leaves the raw error untranslated for the worker retry classifiers", async () => {
      const raw = memoryLimitError();
      const client = fakeClient({
        insert: vi.fn().mockRejectedValue(raw),
      });
      const tenant = tenantClickHouseClient({ client, tenantId: "project-1" });

      await expect(
        tenant.insert({
          table: "traces",
          target: { kind: "replacing" },
          rows: [{ TraceId: "a" }],
        }),
      ).rejects.toBe(raw);
    });
  });
});
