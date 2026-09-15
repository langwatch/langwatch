// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The metered lane's ledger read against real ClickHouse.
 *
 * The rules under test live entirely in the SQL, so no stubbed client can see
 * them: that the read spans every project tenant it is handed and no other,
 * that a failed request priced for its tokens counts, that a request written
 * into two monthly partitions is counted once, that a request is placed on the
 * UTC day it started, and that requests with no dollar amount are counted
 * beside the total rather than inside it.
 *
 * Rows are written straight to `gateway_spend` rather than folded from events:
 * what is under test is what the READ does with a given set of rows, which is
 * a property of the query and not of the fold.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 *   ("THE METERED LANE READS THE GATEWAY'S OWN LEDGER")
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GovernanceGatewaySpendClickHouseRepository } from "../governanceGatewaySpend.clickhouse.repository";

const NANO = 1_000_000_000;

let ch: ClickHouseClient;
let repo: GovernanceGatewaySpendClickHouseRepository;

/** Two projects of the viewer's org, and one of a different org's. */
let projectA: string;
let projectB: string;
let projectOther: string;

/** Well inside the ledger's 13-month TTL, so nothing is swept mid-test. */
const AUG_1 = Date.parse("2026-08-01T12:00:00.000Z");

let eventTimestamp = 1;

/** One `gateway_spend` row. Only the columns these tests read are meaningful. */
function spendRow({
  tenantId,
  gatewayRequestId = `req-${nanoid(12)}`,
  virtualKeyId = "vk_a",
  model = "gpt-5-mini",
  status,
  costNanoUsd,
  tokensInput = 100,
  tokensOutput = 50,
  occurredAtMs = AUG_1,
  eventTimestampOverride,
}: {
  tenantId: string;
  gatewayRequestId?: string;
  virtualKeyId?: string;
  model?: string;
  status: "confirmed" | "failed" | "settled" | "admitted";
  costNanoUsd: number;
  tokensInput?: number;
  tokensOutput?: number;
  occurredAtMs?: number;
  eventTimestampOverride?: number;
}): Record<string, unknown> {
  return {
    TenantId: tenantId,
    GatewayRequestId: gatewayRequestId,
    OrganizationId: "org_ignored_by_read",
    VirtualKeyId: virtualKeyId,
    PrincipalUserId: "",
    EndUserId: "",
    TraceId: "",
    Model: model,
    ProviderKey: "pk-openai",
    RequestType: "chat",
    Status: status,
    ErrorClass: "",
    HttpStatus: status === "failed" ? 500 : 200,
    NeedsReconciliation: status === "settled" ? 1 : 0,
    SettleReason: status === "settled" ? "timeout" : "",
    TokensInput: tokensInput,
    TokensOutput: tokensOutput,
    TokensCacheRead: 0,
    TokensCacheWrite: 0,
    TokensReasoning: 0,
    CostNanoUSD: costNanoUsd,
    RateVersion: "v1",
    Labels: [],
    Metadata: "",
    PodId: "",
    PodSeq: 0,
    DurationMS: 250,
    OccurredAt: new Date(occurredAtMs),
    Version: "",
    CreatedAt: 0,
    LastEventOccurredAt: 0,
    EventTimestamp: eventTimestampOverride ?? eventTimestamp++,
  };
}

async function insert(rows: Record<string, unknown>[]): Promise<void> {
  await ch.insert({
    table: "gateway_spend",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** The window covering the whole seeded month, inclusive at both ends. */
const WINDOW = { fromDay: "2026-08-01", toDay: "2026-08-31" };

describe("the governance gateway spend read", () => {
  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
    repo = new GovernanceGatewaySpendClickHouseRepository(async () => ch);
  });

  beforeEach(() => {
    // Fresh tenants per test: the table is shared, so no test sees another's
    // rows and no hardcoded id can collide with a parallel suite's.
    const run = nanoid(8);
    projectA = `proj-gw-a-${run}`;
    projectB = `proj-gw-b-${run}`;
    projectOther = `proj-gw-other-${run}`;
  });

  describe("given gateway requests under two projects of the org and one of another", () => {
    /** @scenario "The metered lane counts gateway spend from every project of the organization" */
    it("sums both of the org's projects and nothing from the other org", async () => {
      await insert([
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 3 * NANO,
        }),
        spendRow({
          tenantId: projectB,
          status: "confirmed",
          costNanoUsd: 4 * NANO,
        }),
        spendRow({
          tenantId: projectOther,
          status: "confirmed",
          costNanoUsd: 99 * NANO,
        }),
      ]);

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA, projectB],
        ...WINDOW,
      });

      const total = days.reduce((sum, day) => sum + day.amountNanoUsd, 0);
      expect(total).toBe(7 * NANO);
      // The other org's request is not in reach of this read at all.
      expect(total).not.toBe(106 * NANO);
    });
  });

  describe("given a confirmed request and a failed one priced for its tokens", () => {
    /** @scenario "A failed request that consumed tokens still counts as metered spend" */
    it("puts both amounts in the metered total", async () => {
      await insert([
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 5 * NANO,
        }),
        spendRow({
          tenantId: projectA,
          status: "failed",
          costNanoUsd: 2 * NANO,
        }),
      ]);

      const [day] = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      expect(day?.amountNanoUsd).toBe(7 * NANO);
      expect(day?.requestCount).toBe(2);
      expect(day?.requestsWithoutAmount).toBe(0);
    });
  });

  describe("given a request written into two months with different start times", () => {
    /** @scenario "A request written into two months is counted once" */
    it("counts the request's amount exactly once", async () => {
      const requestId = `req-split-${nanoid(8)}`;
      // Outcome recorded first, in July, then admission moved the start into
      // August. Two rows, two partitions, one request — the newer
      // EventTimestamp is the one the read keeps.
      await insert([
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 8 * NANO,
          occurredAtMs: Date.parse("2026-07-31T23:00:00.000Z"),
          eventTimestampOverride: 10,
        }),
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 8 * NANO,
          occurredAtMs: AUG_1,
          eventTimestampOverride: 20,
        }),
      ]);

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        fromDay: "2026-07-01",
        toDay: "2026-08-31",
      });

      const total = days.reduce((sum, day) => sum + day.amountNanoUsd, 0);
      const requests = days.reduce((sum, day) => sum + day.requestCount, 0);
      expect(total).toBe(8 * NANO);
      // 16 is the request counted once per partition it landed in.
      expect(total).not.toBe(16 * NANO);
      expect(requests).toBe(1);
    });
  });

  describe("given a request whose latest version moved its start out of the window", () => {
    /** @scenario "A request written into two months is counted once" */
    it("contributes nothing to a window the request left", async () => {
      const requestId = `req-left-${nanoid(8)}`;
      // Version 1 started inside the window; version 2, the one the ledger
      // now holds as the request, moved the start two hours before it. A
      // window filter on the raw rows keeps version 1 alone — the version
      // 2 row fails it — and counts a request that is no longer in the
      // window, at a cost the ledger has since replaced.
      await insert([
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 5 * NANO,
          occurredAtMs: Date.parse("2026-08-01T10:00:00.000Z"),
          eventTimestampOverride: 10,
        }),
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 7 * NANO,
          occurredAtMs: Date.parse("2026-07-31T22:00:00.000Z"),
          eventTimestampOverride: 20,
        }),
      ]);

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      const total = days.reduce((sum, day) => sum + day.amountNanoUsd, 0);
      const requests = days.reduce((sum, day) => sum + day.requestCount, 0);
      expect(total).toBe(0);
      expect(requests).toBe(0);
    });
  });

  describe("given a request whose late admission moved its start days before the window", () => {
    /** @scenario "A request written into two months is counted once" */
    it("contributes nothing, however far back the start moved", async () => {
      const requestId = `req-late-admit-${nanoid(8)}`;
      // The outcome folded first with a start inside the window; the
      // admission folded three days later in ledger order and set the start
      // three days before the window. Nothing bounds that gap — the brokered
      // path admits on one emitter and confirms on another — so no widened
      // prefilter on the raw rows is safe. Only the collapsed request's own
      // start time can decide the window.
      await insert([
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 5 * NANO,
          occurredAtMs: Date.parse("2026-08-01T10:00:00.000Z"),
          eventTimestampOverride: 10,
        }),
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 7 * NANO,
          occurredAtMs: Date.parse("2026-07-29T10:00:00.000Z"),
          eventTimestampOverride: 20,
        }),
      ]);

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      const total = days.reduce((sum, day) => sum + day.amountNanoUsd, 0);
      const requests = days.reduce((sum, day) => sum + day.requestCount, 0);
      expect(total).toBe(0);
      expect(requests).toBe(0);
    });
  });

  describe("given a request whose latest version moved its start into the window", () => {
    /** @scenario "A request written into two months is counted once" */
    it("counts the request once, at the cost its latest version carries", async () => {
      const requestId = `req-entered-${nanoid(8)}`;
      await insert([
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 5 * NANO,
          occurredAtMs: Date.parse("2026-07-31T22:00:00.000Z"),
          eventTimestampOverride: 10,
        }),
        spendRow({
          tenantId: projectA,
          gatewayRequestId: requestId,
          status: "confirmed",
          costNanoUsd: 7 * NANO,
          occurredAtMs: Date.parse("2026-08-01T10:00:00.000Z"),
          eventTimestampOverride: 20,
        }),
      ]);

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      expect(days).toHaveLength(1);
      expect(days[0]?.day).toBe("2026-08-01");
      expect(days[0]?.amountNanoUsd).toBe(7 * NANO);
      expect(days[0]?.requestCount).toBe(1);
    });
  });

  describe("given a stream admitted before midnight whose answer finished after", () => {
    /** @scenario "A stream crossing midnight belongs to the day it started" */
    it("places the whole amount on the day the request started", async () => {
      await insert([
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 6 * NANO,
          occurredAtMs: Date.parse("2026-08-10T23:50:00.000Z"),
        }),
      ]);

      const days = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      expect(days).toHaveLength(1);
      expect(days[0]?.day).toBe("2026-08-10");
      expect(days[0]?.amountNanoUsd).toBe(6 * NANO);
    });
  });

  describe("given priced requests, token-only zero-cost requests, and a settled one", () => {
    /** @scenario "Requests with no dollar amount are counted beside the metered total, not inside it" */
    it("totals only the priced requests and counts the rest beside them", async () => {
      await insert([
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 10 * NANO,
        }),
        // Consumed tokens, priced at nothing — free or unpriced, the ledger
        // cannot tell which, so it is "no dollar amount" rather than a zero
        // in the total.
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 0,
          tokensInput: 100,
          tokensOutput: 20,
        }),
        // Settled: admitted, never confirmed, cost unknown.
        spendRow({
          tenantId: projectA,
          status: "settled",
          costNanoUsd: 0,
          tokensInput: 0,
          tokensOutput: 0,
        }),
      ]);

      const [day] = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      expect(day?.amountNanoUsd).toBe(10 * NANO);
      // Two carry no dollar amount: the zero-cost-with-tokens one and the
      // settled one.
      expect(day?.requestsWithoutAmount).toBe(2);
      // requestCount is the priced-or-charged confirmed+failed rows.
      expect(day?.requestCount).toBe(2);
      // Of those, only the $10 one is priced.
      expect(day?.pricedRequestCount).toBe(1);
    });
  });

  describe("given a day of only zero-cost requests that consumed tokens", () => {
    /** @scenario "A window of only requests with no dollar amount still shows the metered lane" */
    it("reports the requests as charged but none of them as priced", async () => {
      await insert([
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 0,
          tokensInput: 100,
          tokensOutput: 20,
        }),
        spendRow({
          tenantId: projectA,
          status: "confirmed",
          costNanoUsd: 0,
          tokensInput: 300,
          tokensOutput: 40,
        }),
      ]);

      const [day] = await repo.sumDaysForOrganizationProjects({
        tenantIds: [projectA],
        ...WINDOW,
      });

      // Charged, tokens consumed, priced at nothing: the ledger does not know
      // what these cost. The priced count is what lets the service say so
      // instead of rendering the zero sum as a figure.
      expect(day?.amountNanoUsd).toBe(0);
      expect(day?.requestCount).toBe(2);
      expect(day?.pricedRequestCount).toBe(0);
      expect(day?.requestsWithoutAmount).toBe(2);
    });
  });

  describe("given requests from two virtual keys against two models", () => {
    /** @scenario "Metered spend is grouped by model and by virtual key, never by person" */
    it("totals each model and each virtual key on its own", async () => {
      await insert([
        spendRow({
          tenantId: projectA,
          model: "gpt-5-mini",
          virtualKeyId: "vk_1",
          status: "confirmed",
          costNanoUsd: 3 * NANO,
        }),
        spendRow({
          tenantId: projectA,
          model: "claude-sonnet-5",
          virtualKeyId: "vk_2",
          status: "confirmed",
          costNanoUsd: 4 * NANO,
        }),
      ]);

      const byModel = await repo.sumWindowByModel({
        tenantIds: [projectA],
        ...WINDOW,
      });
      const byKey = await repo.sumWindowByVirtualKey({
        tenantIds: [projectA],
        ...WINDOW,
      });

      expect(
        byModel.find((row) => row.model === "gpt-5-mini")?.amountNanoUsd,
      ).toBe(3 * NANO);
      expect(
        byModel.find((row) => row.model === "claude-sonnet-5")?.amountNanoUsd,
      ).toBe(4 * NANO);
      expect(
        byKey.find((row) => row.virtualKeyId === "vk_1")?.amountNanoUsd,
      ).toBe(3 * NANO);
      expect(
        byKey.find((row) => row.virtualKeyId === "vk_2")?.amountNanoUsd,
      ).toBe(4 * NANO);
    });
  });

  describe("given two models where the smaller amount is the larger string", () => {
    /** @scenario "Metered spend is grouped by model and by virtual key, never by person" */
    it("ranks the larger amount first, in money order not text order", async () => {
      // "88986800" > "7619357500" as strings; $0.089 < $7.62 as money. The
      // production ranking had these the wrong way round.
      const small = 88_986_800;
      const large = 7_619_357_500;
      await insert([
        spendRow({
          tenantId: projectA,
          model: "small-as-money",
          virtualKeyId: "vk_small",
          status: "confirmed",
          costNanoUsd: small,
        }),
        spendRow({
          tenantId: projectA,
          model: "large-as-money",
          virtualKeyId: "vk_large",
          status: "confirmed",
          costNanoUsd: large,
        }),
      ]);

      const byModel = await repo.sumWindowByModel({
        tenantIds: [projectA],
        ...WINDOW,
      });
      const byKey = await repo.sumWindowByVirtualKey({
        tenantIds: [projectA],
        ...WINDOW,
      });

      expect(byModel.map((row) => row.model)).toEqual([
        "large-as-money",
        "small-as-money",
      ]);
      expect(byKey.map((row) => row.virtualKeyId)).toEqual([
        "vk_large",
        "vk_small",
      ]);
    });
  });
});
