/**
 * The stores wire the shadow sampler (ADR-202 Rollout 3): off by default, on only with a rate
 * and the enforcing reader's credential, the shared server only, counted by table.
 * @see specs/clickhouse/app-reader-identity.feature
 */
import { createServer, type Server } from "node:http";

import { parseProcessConfig } from "@langwatch/config";
import { createRecordingMeterProvider } from "@langwatch/observability/metrics/testing";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { buildClickHouse } from "../clickhouse-member.ts";
import { storesOwner } from "../config-owner.ts";
import type { ClickHouseConfig } from "../config.ts";

const metrics = createRecordingMeterProvider();

interface FakeServer {
  url: string;
  received: { url: string; body: string }[];
  close: () => Promise<void>;
}

/** A ClickHouse stand-in that records each statement and answers with fixed rows. */
async function fakeServer(rows: readonly Record<string, unknown>[]): Promise<FakeServer> {
  const received: FakeServer["received"] = [];
  const server: Server = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => (body += chunk.toString()));
    request.on("end", () => {
      received.push({ url: request.url ?? "", body });
      response.setHeader("Content-Type", "application/x-ndjson");
      response.end(rows.map((row) => `${JSON.stringify(row)}\n`).join(""));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("No port was bound.");
  return {
    url: `http://127.0.0.1:${address.port}`,
    received,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

const READ = {
  tenantId: "project_1",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project_1" },
  table: "trace_summaries",
};

let system: FakeServer;
let reader: FakeServer;
let enforcing: FakeServer;

beforeAll(async () => {
  metrics.install();
  system = await fakeServer([]);
  reader = await fakeServer([{ TraceId: "t1" }, { TraceId: "t2" }]);
  enforcing = await fakeServer([{ enforced: "1" }]);
});

afterEach(() => {
  for (const server of [system, reader, enforcing]) server.received.length = 0;
});

afterAll(async () => {
  metrics.uninstall();
  await Promise.all([system, reader, enforcing].map((server) => server.close()));
});

async function readAs({
  config,
  organization = "org_shared",
}: {
  config: Partial<ClickHouseConfig>;
  organization?: string;
}): Promise<number> {
  const member = buildClickHouse({
    config: { url: system.url, readerUrl: reader.url, ...config },
    directory: { organizationForTenant: () => Promise.resolve(organization) },
  });
  try {
    const { rows } = await member.value.query(READ);
    return rows.length;
  } finally {
    await member.close?.();
  }
}

describe("given the stores' ClickHouse member with a reader credential", () => {
  describe("when the sample rate is above 0 and the enforcing reader is set", () => {
    /** @scenario "The stores re-run sampled reads on the enforcing reader and count a divergence by table" */
    it("re-runs the read as a count on the enforcing reader and counts the divergence", async () => {
      const member = buildClickHouse({
        config: {
          url: system.url,
          readerUrl: reader.url,
          enforcingReaderUrl: enforcing.url,
          shadowSampleRate: 1,
        },
        directory: { organizationForTenant: () => Promise.resolve("org_shared") },
      });
      try {
        const { rows } = await member.value.query(READ);
        expect(rows).toHaveLength(2);
        await vi.waitFor(() =>
          expect(metrics.recorded).toContainEqual({
            instrument: "clickhouse_shadow_divergence_total",
            value: 1,
            attributes: { table: "trace_summaries" },
          }),
        );
      } finally {
        await member.close?.();
      }

      const [rerun] = enforcing.received;
      expect(rerun?.body).toMatch(/^SELECT count\(\) AS enforced FROM \(SELECT TraceId/);
      expect(
        new URL(rerun?.url ?? "", enforcing.url).searchParams.get("SQL_langwatch_tenant_ids"),
      ).toBe("project_1");
      expect(system.received).toEqual([]);
    });
  });

  describe("when the sample rate is 0", () => {
    /** @scenario "The shadow sampler is off unless a rate and the enforcing reader are configured" */
    it("sends nothing to the enforcing reader", async () => {
      expect(
        await readAs({ config: { enforcingReaderUrl: enforcing.url, shadowSampleRate: 0 } }),
      ).toBe(2);
      expect(await readAs({ config: { shadowSampleRate: 1 } })).toBe(2);

      expect(enforcing.received).toEqual([]);
    });
  });

  describe("when the read belongs to an organisation with a private route", () => {
    /** @scenario "The shadow sampler never re-runs a private organisation's read on the shared server" */
    it("never sends it to the enforcing reader and counts no failure", async () => {
      const route = { organizationId: "org_1", label: "acme" };
      const returned = await readAs({
        config: {
          enforcingReaderUrl: enforcing.url,
          shadowSampleRate: 1,
          privateRoutes: [{ ...route, url: system.url }],
          readerPrivateRoutes: [{ ...route, url: reader.url }],
        },
        organization: "org_1",
      });
      // The detached re-run settles on the refusal before the member closes.
      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(returned).toBe(2);
      expect(enforcing.received).toEqual([]);
      expect(metrics.recorded.map(({ instrument }) => instrument)).not.toContain(
        "clickhouse_shadow_rerun_failed_total",
      );
    });
  });
});

describe("CLICKHOUSE_SHADOW_SAMPLE_RATE in the stores' configuration", () => {
  const read = (environment: Record<string, string | undefined>) =>
    parseProcessConfig({ owners: [storesOwner], environment }).stores.clickhouseShadowSampleRate;

  /** @scenario "The shadow sampler is off unless a rate and the enforcing reader are configured" */
  it("defaults to 0 and reads a share between 0 and 1", () => {
    expect(read({})).toBe(0);
    expect(read({ CLICKHOUSE_SHADOW_SAMPLE_RATE: "0.05" })).toBe(0.05);
  });

  /** @scenario "A shadow sample rate outside 0 to 1 is refused at boot" */
  it("refuses a rate above 1 by its variable", () => {
    expect(() => read({ CLICKHOUSE_SHADOW_SAMPLE_RATE: "5" })).toThrow(
      /CLICKHOUSE_SHADOW_SAMPLE_RATE/,
    );
  });
});
