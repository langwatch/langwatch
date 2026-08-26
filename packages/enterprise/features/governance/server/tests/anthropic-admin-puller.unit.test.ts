import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AnthropicAdminPuller } from "../src/adapters/anthropic-admin-puller.adapter";
import {
  GovernanceHttpPort,
  type GovernanceHttpResponse,
} from "../src/ports/governance-http.port";

const options = { cursor: null, credentials: { token: "admin-key" } };
const usageConfig = {
  adapter: "anthropic_admin",
  report: "usage",
  bucketWidth: "1d",
  schedule: "0 * * * *",
  startingAt: "2026-08-01T00:00:00.000Z",
};
const costConfig = { ...usageConfig, report: "cost" };

const usageRow = {
  uncached_input_tokens: 120_000,
  cache_creation: {
    ephemeral_1h_input_tokens: 1_000,
    ephemeral_5m_input_tokens: 500,
  },
  cache_read_input_tokens: 4_000,
  output_tokens: 8_000,
  model: "anthropic/claude-sonnet-5",
  workspace_id: "workspace-1",
  api_key_id: "key-1",
  service_tier: "standard",
  context_window: "0-200k",
};

const costRow = {
  amount: "41280.000000",
  currency: "USD",
  workspace_id: "workspace-1",
  description: "Claude usage",
  cost_type: "tokens",
  model: "anthropic/claude-sonnet-5",
};

function usagePage(overrides: Record<string, unknown> = {}) {
  return {
    data: [
      {
        starting_at: "2026-08-01T00:00:00Z",
        ending_at: "2026-08-02T00:00:00Z",
        results: [usageRow],
      },
    ],
    has_more: false,
    next_page: null,
    ...overrides,
  };
}

function costPage(overrides: Record<string, unknown> = {}) {
  return {
    data: [{ starting_at: "2026-08-01T00:00:00Z", results: [costRow] }],
    has_more: false,
    next_page: null,
    ...overrides,
  };
}

function response(body: unknown, status = 200): GovernanceHttpResponse {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "failed",
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

class FakeHttp extends GovernanceHttpPort {
  readonly calls: Array<{
    url: string;
    init: Parameters<GovernanceHttpPort["fetch"]>[1];
  }> = [];
  readonly responses: Array<GovernanceHttpResponse | Error> = [];

  async fetch(
    url: string,
    init: Parameters<GovernanceHttpPort["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    this.calls.push({ url, init });
    const next = this.responses.shift();
    if (next instanceof Error) throw next;
    if (!next) throw new Error("test did not queue an Anthropic response");
    return next;
  }
}

function puller(http: FakeHttp): AnthropicAdminPuller {
  return AnthropicAdminPuller.create(http);
}

const hintSchema = z.object({
  dimensions: z.record(z.string(), z.string()),
  tokensCacheRead: z.number().optional(),
  tokensCacheWrite: z.number().optional(),
  costBasis: z.string(),
  costStatus: z.string().optional(),
  costUsd: z.string().optional(),
});

function hint(event: { extra?: Record<string, unknown> }) {
  return hintSchema.parse(event.extra?.[PULLED_USAGE_HINT_KEY]);
}

describe("Anthropic Admin puller", () => {
  it("maps usage buckets with cache creation and all identity dimensions", async () => {
    const http = new FakeHttp();
    http.responses.push(response(usagePage()));
    const adapter = puller(http);

    const result = await adapter.runOnce(options, adapter.validateConfig(usageConfig));
    const event = result.events[0]!;

    expect(result).toMatchObject({ errorCount: 0 });
    expect(event).toMatchObject({
      tokens_input: 120_000,
      tokens_output: 8_000,
      cost_usd: "0",
    });
    expect(hint(event)).toMatchObject({
      costBasis: "computed",
      tokensCacheRead: 4_000,
      tokensCacheWrite: 1_500,
      dimensions: { serviceTier: "standard", contextWindow: "0-200k" },
    });
    expect(http.calls[0]?.url).toContain("group_by%5B%5D=service_tier");
    expect(http.calls[0]?.url).toContain("group_by%5B%5D=context_window");
  });

  it("keeps tier and context-window variants as separate records", async () => {
    const http = new FakeHttp();
    http.responses.push(
      response(
        usagePage({
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [
                usageRow,
                { ...usageRow, context_window: "200k-1M" },
                { ...usageRow, service_tier: "batch" },
              ],
            },
          ],
        }),
      ),
    );
    const adapter = puller(http);

    const result = await adapter.runOnce(options, adapter.validateConfig(usageConfig));

    expect(new Set(result.events.map((event) => event.source_event_id)).size).toBe(3);
  });

  it("supports the previous flat cache creation field", async () => {
    const { cache_creation: _cacheCreation, ...legacyRow } = usageRow;
    const http = new FakeHttp();
    http.responses.push(
      response(
        usagePage({
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...legacyRow, cache_creation_input_tokens: 2_345 }],
            },
          ],
        }),
      ),
    );
    const adapter = puller(http);

    const result = await adapter.runOnce(options, adapter.validateConfig(usageConfig));

    expect(hint(result.events[0]!)).toMatchObject({ tokensCacheWrite: 2_345 });
  });

  it("converts provider cents exactly and records an estimate", async () => {
    const http = new FakeHttp();
    http.responses.push(response(costPage()));
    const adapter = puller(http);

    const result = await adapter.runOnce(options, adapter.validateConfig(costConfig));
    const event = result.events[0]!;

    expect(event.cost_usd).toBe("412.80000000");
    expect(hint(event)).toMatchObject({
      costBasis: "provider_reported",
      costStatus: "estimate",
      costUsd: "412.80000000",
      dimensions: { bucketWidth: "1d" },
    });
  });

  it("keeps decimal and exponent cost precision outside a float", async () => {
    const http = new FakeHttp();
    http.responses.push(
      response(
        costPage({
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [
                { ...costRow, amount: "0.0000001" },
                { ...costRow, amount: "1e-7", description: "exponent" },
              ],
            },
          ],
        }),
      ),
    );
    const adapter = puller(http);

    const result = await adapter.runOnce(options, adapter.validateConfig(costConfig));

    expect(result.events.map((event) => event.cost_usd)).toEqual(["0.000000001", "1e-9"]);
  });

  it("drops unsupported or malformed cost rows without blocking the remaining bucket", async () => {
    const http = new FakeHttp();
    http.responses.push(
      response(
        costPage({
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [
                { ...costRow, currency: "EUR" },
                { ...costRow, amount: "not-money" },
                costRow,
              ],
            },
          ],
        }),
      ),
    );
    const adapter = puller(http);

    const result = await adapter.runOnce(options, adapter.validateConfig(costConfig));

    expect(result).toMatchObject({ errorCount: 0 });
    expect(result.events).toHaveLength(1);
  });

  it("pins cost requests and identities to daily buckets", async () => {
    const hourly = new FakeHttp();
    hourly.responses.push(response(costPage()));
    const daily = new FakeHttp();
    daily.responses.push(response(costPage()));
    const hourlyAdapter = puller(hourly);
    const dailyAdapter = puller(daily);

    const hourlyRun = await hourlyAdapter.runOnce(
      options,
      hourlyAdapter.validateConfig({ ...costConfig, bucketWidth: "1h" }),
    );
    const dailyRun = await dailyAdapter.runOnce(
      options,
      dailyAdapter.validateConfig(costConfig),
    );

    expect(hourly.calls[0]?.url).toContain("bucket_width=1d");
    expect(hourlyRun.events[0]?.source_event_id).toBe(
      dailyRun.events[0]?.source_event_id,
    );
  });

  it("encodes dimensions so delimiter movement cannot collapse identities", async () => {
    const first = new FakeHttp();
    first.responses.push(
      response(
        costPage({
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...costRow, description: "a:b", cost_type: "c" }],
            },
          ],
        }),
      ),
    );
    const second = new FakeHttp();
    second.responses.push(
      response(
        costPage({
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...costRow, description: "a", cost_type: "b:c" }],
            },
          ],
        }),
      ),
    );
    const firstAdapter = puller(first);
    const secondAdapter = puller(second);

    const firstRun = await firstAdapter.runOnce(
      options,
      firstAdapter.validateConfig(costConfig),
    );
    const secondRun = await secondAdapter.runOnce(
      options,
      secondAdapter.validateConfig(costConfig),
    );

    expect(firstRun.events[0]?.source_event_id).not.toBe(
      secondRun.events[0]?.source_event_id,
    );
  });

  it("reuses an unchanged page token and retains its latest watermark across a deadline", async () => {
    const first = new FakeHttp();
    first.responses.push(
      ...Array.from({ length: 20 }, () =>
        response(usagePage({ has_more: true, next_page: "page-2" })),
      ),
    );
    const adapter = puller(first);
    const partial = await adapter.runOnce(options, adapter.validateConfig(usageConfig));

    const resumed = new FakeHttp();
    resumed.responses.push(response(usagePage()));
    const resumedAdapter = puller(resumed);
    await resumedAdapter.runOnce(
      { ...options, cursor: partial.cursor },
      resumedAdapter.validateConfig(usageConfig),
    );

    const deadline = new FakeHttp();
    const deadlineAdapter = puller(deadline);
    const stopped = await deadlineAdapter.runOnce(
      { ...options, cursor: partial.cursor, deadlineMs: Date.now() - 1 },
      deadlineAdapter.validateConfig(usageConfig),
    );

    expect(resumed.calls[0]?.url).toContain("page=page-2");
    expect(JSON.parse(stopped.cursor ?? "{}")).toMatchObject({
      page: "page-2",
      watermark: "2026-08-01T00:00:00Z",
    });
  });

  it("drops a stale usage page token but resumes from its watermark", async () => {
    const http = new FakeHttp();
    http.responses.push(response(usagePage()));
    const adapter = puller(http);
    const cursor = JSON.stringify({
      startingAt: "2026-08-01T00:00:00.000Z",
      page: "stale-page",
      query: "usage:1d:model,workspace_id,api_key_id,service_tier,context_window",
      watermark: "2026-08-02T00:00:00.000Z",
    });

    await adapter.runOnce(
      { ...options, cursor },
      adapter.validateConfig({ ...usageConfig, bucketWidth: "1h" }),
    );

    expect(http.calls[0]?.url).not.toContain("page=stale-page");
    expect(http.calls[0]?.url).toContain("starting_at=2026-08-02T00%3A00%3A00.000Z");
  });

  it("rewinds stale cost cursors to the configured repair window without moving a backlog forward", async () => {
    const repair = new FakeHttp();
    repair.responses.push(response(costPage()));
    const repairAdapter = puller(repair);
    await repairAdapter.runOnce(
      {
        ...options,
        cursor: JSON.stringify({ startingAt: "2026-08-05T00:00:00.000Z", page: null }),
      },
      repairAdapter.validateConfig({
        ...costConfig,
        startingAt: "2026-07-01T00:00:00.000Z",
      }),
    );

    const backlog = new FakeHttp();
    backlog.responses.push(response(costPage()));
    const backlogAdapter = puller(backlog);
    await backlogAdapter.runOnce(
      {
        ...options,
        cursor: JSON.stringify({ startingAt: "2026-06-01T00:00:00.000Z", page: null }),
      },
      backlogAdapter.validateConfig(costConfig),
    );

    expect(repair.calls[0]?.url).toContain("starting_at=2026-07-01T00%3A00%3A00.000Z");
    expect(backlog.calls[0]?.url).toContain("starting_at=2026-06-01T00%3A00%3A00.000Z");
  });

  it("refuses a missing next page, holds failures, and rejects an invalid configuration", async () => {
    const malformed = new FakeHttp();
    malformed.responses.push(response(usagePage({ has_more: true, next_page: null })));
    const failed = new FakeHttp();
    failed.responses.push(new Error("connection reset"));
    const malformedAdapter = puller(malformed);
    const failedAdapter = puller(failed);

    await expect(
      malformedAdapter.runOnce(options, malformedAdapter.validateConfig(usageConfig)),
    ).rejects.toThrow(/has_more/);
    await expect(
      failedAdapter.runOnce(
        { ...options, cursor: "held" },
        failedAdapter.validateConfig(usageConfig),
      ),
    ).resolves.toMatchObject({ cursor: "held", errorCount: 1 });
    await expect(
      failedAdapter.runOnce({ cursor: null }, failedAdapter.validateConfig(usageConfig)),
    ).resolves.toMatchObject({ cursor: null, errorCount: 1 });
    expect(() =>
      puller(new FakeHttp()).validateConfig({
        ...usageConfig,
        report: ["usage", "cost"],
      }),
    ).toThrow(z.ZodError);
  });
});
