import {
  anthropicAdminPullConfigSchema,
  PULLED_USAGE_HINT_KEY,
} from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  drainedWindowStart,
  encodeCursor,
  queryIdentity,
  reportUrl,
  usageEvent,
  usageResultSchema,
} from "../anthropic-admin-report.rules.ts";

const usageConfig = anthropicAdminPullConfigSchema.parse({
  adapter: "anthropic_admin",
  report: "usage",
  bucketWidth: "1h",
});
const costConfig = anthropicAdminPullConfigSchema.parse({
  adapter: "anthropic_admin",
  report: "cost",
  startingAt: "2026-01-01T00:00:00Z",
});

describe("reportUrl()", () => {
  it("asks the usage report for every dimension its key is built from", () => {
    const url = reportUrl({ config: usageConfig, startingAt: "2026-01-01T00:00:00Z", page: "tok" });

    expect(url.toString()).toBe(
      "https://api.anthropic.com/v1/organizations/usage_report/messages" +
        "?starting_at=2026-01-01T00%3A00%3A00Z&bucket_width=1h" +
        "&group_by%5B%5D=model&group_by%5B%5D=workspace_id&group_by%5B%5D=api_key_id" +
        "&group_by%5B%5D=service_tier&group_by%5B%5D=context_window&page=tok",
    );
  });

  it("pins the cost report to daily buckets and sends no page on a fresh window", () => {
    const url = reportUrl({ config: costConfig, startingAt: "2026-01-01T00:00:00Z", page: null });

    expect(url.toString()).toBe(
      "https://api.anthropic.com/v1/organizations/cost_report" +
        "?starting_at=2026-01-01T00%3A00%3A00Z&bucket_width=1d" +
        "&group_by%5B%5D=workspace_id&group_by%5B%5D=description",
    );
  });
});

describe("queryIdentity() and encodeCursor()", () => {
  it("binds usage to its width and group-by, and cost to its repair window", () => {
    expect(queryIdentity(usageConfig)).toBe(
      "usage:1h:model,workspace_id,api_key_id,service_tier,context_window",
    );
    expect(queryIdentity(costConfig)).toBe("cost:1d:workspace_id,description:2026-01-01T00:00:00Z");
  });

  it("writes the cursor's fields in one fixed order", () => {
    expect(encodeCursor({ startingAt: "a", page: null, query: "q", watermark: "w" })).toBe(
      '{"startingAt":"a","page":null,"query":"q","watermark":"w"}',
    );
  });
});

describe("usageEvent()", () => {
  it("maps one usage row to a computed-cost event keyed by its bucket and dimensions", () => {
    const result = usageResultSchema.parse({
      uncached_input_tokens: 10,
      output_tokens: 5,
      cache_read_input_tokens: 2,
      cache_creation: { ephemeral_1h_input_tokens: 1, ephemeral_5m_input_tokens: 3 },
      model: "claude-x",
      workspace_id: "ws",
      service_tier: "standard",
    });

    const event = usageEvent({ result, startingAt: "2026-01-01T00:00:00Z", config: usageConfig });

    const dimensions = {
      report: "usage",
      bucketWidth: "1h",
      model: "claude-x",
      workspaceId: "ws",
      apiKeyId: "",
      serviceTier: "standard",
      contextWindow: "",
    };
    expect(event).toEqual({
      source_event_id: "usage:2026-01-01T00:00:00Z:usage:1h:claude-x:ws::standard:",
      event_timestamp: "2026-01-01T00:00:00Z",
      actor: "",
      action: "usage_report",
      target: "claude-x",
      cost_usd: "0",
      tokens_input: 10,
      tokens_output: 5,
      raw_payload: JSON.stringify(result),
      extra: {
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "computed",
          dimensions,
          model: "claude-x",
          tokensCacheRead: 2,
          tokensCacheWrite: 4,
        },
      },
    });
  });
});

describe("drainedWindowStart()", () => {
  it("resumes from the newest bucket emitted, never below the position on record", () => {
    const positionOnRecord = "2026-01-05T00:00:00Z";

    expect(drainedWindowStart({ newestEmitted: null, positionOnRecord })).toBe(positionOnRecord);
    expect(drainedWindowStart({ newestEmitted: "2026-01-02T00:00:00Z", positionOnRecord })).toBe(
      positionOnRecord,
    );
    expect(drainedWindowStart({ newestEmitted: "2026-01-07T00:00:00Z", positionOnRecord })).toBe(
      "2026-01-07T00:00:00Z",
    );
  });
});
