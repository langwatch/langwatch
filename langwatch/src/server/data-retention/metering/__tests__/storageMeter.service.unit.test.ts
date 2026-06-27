import { describe, expect, it, vi } from "vitest";
import { RETENTION_MANAGED_TABLES } from "../../retentionPolicy.schema";
import { StorageMeterService } from "../storageMeter.service";

/**
 * The metering reads sum a lazily-recomputed MATERIALIZED byteSize(...) column
 * across heavy payload columns, which exceeded the ClickHouse per-query memory
 * limit for large tenants. Every metering query must carry the bounded-memory
 * settings (capped read streams) so the recompute stays within budget instead
 * of failing the read.
 */
describe("StorageMeterService memory guard", () => {
  function makeService() {
    const query = vi.fn().mockResolvedValue({
      json: async () => [{ total: "42" }],
    });
    const client = { query } as const;
    const service = new StorageMeterService(async () => client as any);
    return { service, query };
  }

  function assertGuarded(call: { clickhouse_settings?: Record<string, unknown> }) {
    expect(call.clickhouse_settings).toBeDefined();
    expect(call.clickhouse_settings!.max_threads).toBe(2);
    // A coarse guardrail so a runaway byteSize recompute can't grind for a
    // minute; a materialized read finishes in seconds, well under this.
    expect(call.clickhouse_settings!.max_execution_time).toBe(45);
  }

  describe("when computing the per-category storage breakdown", () => {
    it("passes the bounded-memory settings on every per-table query", async () => {
      const { service, query } = makeService();

      await service.getStorageBreakdown({ tenantId: "project-1" });

      expect(query.mock.calls.length).toBeGreaterThan(0);
      for (const [arg] of query.mock.calls) {
        assertGuarded(arg);
      }
    });
  });

  describe("when computing the total storage bytes", () => {
    it("passes the bounded-memory settings on the aggregate query", async () => {
      const { service, query } = makeService();

      await service.getTotalStorageBytes({ tenantId: "project-total" });

      expect(query).toHaveBeenCalledTimes(1);
      assertGuarded(query.mock.calls[0]![0]);
    });
  });

  describe("given a heavy tenant where the aggregate query can exceed limits", () => {
    describe("when the single aggregate total query fails", () => {
      it("falls back to the per-table breakdown instead of throwing", async () => {
        // The combined UNION ALL aggregate trips the per-query limit, but each
        // table's own query still succeeds — the total should degrade to the
        // sum of the per-table subtotals rather than failing the whole metric.
        const query = vi.fn().mockImplementation(async (arg: { query: string }) => {
          if (arg.query.includes("UNION ALL")) {
            throw new Error("Code: 241. DB::Exception: memory limit exceeded");
          }
          return { json: async () => [{ total: "10" }] };
        });
        const client = { query } as const;
        const service = new StorageMeterService(async () => client as any);

        const total = await service.getTotalStorageBytes({ tenantId: "p-heavy" });

        expect(total).toBe(10 * RETENTION_MANAGED_TABLES.length);
        // one failed aggregate attempt + one query per table for the fallback
        expect(query).toHaveBeenCalledTimes(1 + RETENTION_MANAGED_TABLES.length);
      });
    });
  });
});

/**
 * The billable-storage measurement sums an organization's logical bytes older
 * than the free window, anchored to a past sealed hour. It is a pure read used
 * by the Stripe reporting pipeline — correctness over availability: any query
 * failure throws rather than silently undercounting the bill.
 */
describe("StorageMeterService billable measurement", () => {
  // 2026-06-26T12:00:00Z. Cutoff = H − 35 days = 2026-05-22T12:00:00Z.
  const H = new Date("2026-06-26T12:00:00.000Z");
  const EXPECTED_CUTOFF = "2026-05-22 12:00:00";

  function makeService({
    projectIds,
    projectIdsByOrg,
    perTenantBytes = () => "100",
    failOn,
  }: {
    projectIds?: string[];
    projectIdsByOrg?: Record<string, string[]>;
    perTenantBytes?: (tenantId: string) => string;
    failOn?: string;
  }) {
    const query = vi.fn(
      async (call: {
        query: string;
        query_params: { tenantId: string; cutoff: string };
        clickhouse_settings: Record<string, unknown>;
      }) => {
        const tenantId = call.query_params.tenantId;
        if (failOn && tenantId === failOn) {
          throw new Error("ClickHouse query failed");
        }
        return { json: async () => [{ total: perTenantBytes(tenantId) }] };
      },
    );
    const client = { query } as const;
    const resolveClient = vi.fn(async () => client as any);
    const resolveProjectIds = vi.fn(
      async (orgId: string) => projectIdsByOrg?.[orgId] ?? projectIds ?? [],
    );
    const service = new StorageMeterService(resolveClient, resolveProjectIds);
    return { service, query, resolveClient, resolveProjectIds };
  }

  describe("given an organization with several projects", () => {
    /** @scenario An organization's measurement sums across all its projects */
    it("sums each project's billable bytes across its own tenant-routed query", async () => {
      const { service, query, resolveClient } = makeService({
        projectIds: ["p1", "p2", "p3"],
        perTenantBytes: () => "100",
      });

      const total = await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      expect(total).toBe(300);
      // One query per tenant, each routed to its own tenant-scoped client.
      expect(query).toHaveBeenCalledTimes(3);
      expect(resolveClient.mock.calls.map(([id]) => id)).toEqual(
        expect.arrayContaining(["p1", "p2", "p3"]),
      );
    });

    /** @scenario Another organization's data is never included */
    it("measures only the target org's tenants, never another org's projects", async () => {
      const { service, query } = makeService({
        projectIdsByOrg: { "org-A": ["p1", "p2"], "org-B": ["p3"] },
      });

      await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      const queriedTenants = query.mock.calls.map(
        ([call]) => call.query_params.tenantId,
      );
      expect(queriedTenants.sort()).toEqual(["p1", "p2"]);
      expect(queriedTenants).not.toContain("p3");
    });

    /** @scenario The measurement reuses the per-tenant path, not a cross-tenant IN, and caps each query */
    it("caps each query's read streams and execution time so the size recompute can't exhaust memory", async () => {
      const { service, query } = makeService({ projectIds: ["p1"] });

      await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      const settings = query.mock.calls[0]![0].clickhouse_settings;
      expect(settings.max_threads).toBe(2);
      expect(settings.max_execution_time).toBeGreaterThan(0);
    });
  });

  describe("given the measurement is anchored to a sealed hour", () => {
    /** @scenario The cutoff is anchored to the sealed hour, not now */
    it("binds the cutoff as H − 35 days, independent of wall-clock time", async () => {
      const { service, query } = makeService({ projectIds: ["p1"] });

      await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      expect(query.mock.calls[0]![0].query_params.cutoff).toBe(EXPECTED_CUTOFF);
    });

    /** @scenario The sealed hour and cutoff are interpreted in UTC regardless of ClickHouse session timezone */
    it("binds the cutoff as an explicit UTC value unaffected by session timezone", async () => {
      const { service, query } = makeService({ projectIds: ["p1"] });

      await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      // String-typed UTC param + DateTime('UTC') annotation in the SQL means
      // ClickHouse parses it in UTC regardless of the session's timezone.
      expect(query.mock.calls[0]![0].query).toContain(
        "{cutoff:DateTime('UTC')}",
      );
      expect(typeof query.mock.calls[0]![0].query_params.cutoff).toBe("string");
    });

    /** @scenario Deletion lowers a later hour's measurement, never an earlier one */
    it("advances the cutoff for a later hour while an earlier hour's cutoff is unchanged", async () => {
      // The measurement at H depends only on (rows present, H): its cutoff is a
      // pure function of the sealed hour. A later hour scans a wider window
      // (later cutoff), so retention deletion between the two can only lower the
      // later measurement — it can never alter what was already measured at H.
      const { service, query } = makeService({ projectIds: ["p1"] });
      const laterHour = new Date(H.getTime() + 60 * 60 * 1000); // H + 1h

      await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });
      await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: laterHour,
      });

      const [atH, atLater] = query.mock.calls.map(
        ([call]) => call.query_params.cutoff,
      );
      expect(atH).toBe(EXPECTED_CUTOFF);
      expect(atLater).toBe("2026-05-22 13:00:00");
      expect(new Date(`${atLater}Z`).getTime()).toBeGreaterThan(
        new Date(`${atH}Z`).getTime(),
      );
    });
  });

  describe("given an organization whose projects hold only data within the free window", () => {
    /** @scenario An organization with no old data measures zero */
    /** @scenario A default-keep paid org bills zero by construction */
    it("measures zero", async () => {
      const { service } = makeService({
        projectIds: ["p1", "p2"],
        perTenantBytes: () => "0",
      });

      const total = await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      expect(total).toBe(0);
    });
  });

  describe("when one table query fails", () => {
    /** @scenario A table query failure fails the measurement instead of silently undercounting */
    it("throws instead of returning a total that omits the failed tenant's bytes", async () => {
      const { service } = makeService({
        projectIds: ["p1", "p2"],
        failOn: "p2",
      });

      await expect(
        service.getBillableStorageBytesForOrgAt({
          organizationId: "org-A",
          sealedHour: H,
        }),
      ).rejects.toThrow();
    });
  });

  describe("when measuring billable bytes", () => {
    /** @scenario The service returns raw logical bytes and leaves rounding to the caller */
    it("returns the raw logical byte count without rounding to MiB", async () => {
      const { service } = makeService({
        projectIds: ["p1"],
        perTenantBytes: () => "1572865", // 1.5 MiB + 1 byte
      });

      const total = await service.getBillableStorageBytesForOrgAt({
        organizationId: "org-A",
        sealedHour: H,
      });

      expect(total).toBe(1572865);
    });
  });
});
