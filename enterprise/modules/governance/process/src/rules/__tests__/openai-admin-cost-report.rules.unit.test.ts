import { PULLED_USAGE_HINT_KEY } from "@langwatch/enterprise-governance-contract";
import { describe, expect, it } from "vitest";

import {
  costResultSchema,
  drainedResult,
  PER_KEY_ATTRIBUTION_UNAVAILABLE,
  type ParsedCursor,
  reportUrl,
  stoppedShortResult,
  usdCostEvent,
} from "../openai-admin-cost-report.rules.ts";

const cursor: ParsedCursor = {
  windowStart: "2026-01-01T00:00:00.000Z",
  storedStart: "2026-01-04T00:00:00.000Z",
  page: null,
  watermark: null,
  hasKeyGrouping: true,
};

describe("reportUrl()", () => {
  it("asks for daily buckets grouped by every key dimension", () => {
    const url = reportUrl({
      startingAt: "2026-01-01T00:00:00Z",
      page: "tok",
      hasKeyGrouping: true,
    });

    expect(url.toString()).toBe(
      "https://api.openai.com/v1/organization/costs" +
        "?start_time=1767225600&bucket_width=1d&limit=180" +
        "&group_by%5B%5D=project_id&group_by%5B%5D=line_item&group_by%5B%5D=user_id" +
        "&group_by%5B%5D=api_key_id&page=tok",
    );
  });

  describe("when the window is read below the key-grouping floor", () => {
    it("groups by the user alone", () => {
      const url = reportUrl({
        startingAt: "2026-01-01T00:00:00Z",
        page: null,
        hasKeyGrouping: false,
      });

      expect(url.toString()).toBe(
        "https://api.openai.com/v1/organization/costs" +
          "?start_time=1767225600&bucket_width=1d&limit=180&group_by%5B%5D=user_id",
      );
    });
  });
});

describe("usdCostEvent()", () => {
  it("maps a dollar row to a provider-reported event and never stores the email", () => {
    const result = costResultSchema.parse({
      amount: { value: 1.5, currency: "usd" },
      line_item: "gpt-5-mini, input",
      project_id: "proj",
      user_id: "user-1",
      api_key_id: "key_1",
      user_email: "person@example.com",
    });

    const event = usdCostEvent({
      result,
      startingAt: "2026-01-01T00:00:00.000Z",
      hasKeyGrouping: true,
    });

    const dimensions = {
      report: "cost",
      bucketWidth: "1d",
      projectId: "proj",
      lineItem: "gpt-5-mini, input",
      userId: "user-1",
      apiKeyId: "key_1",
    };
    expect({ ...event, raw_payload: JSON.parse(event.raw_payload) as unknown }).toEqual({
      source_event_id:
        "cost:2026-01-01T00:00:00.000Z:cost:1d:proj:gpt-5-mini%2C%20input:user-1:key_1",
      event_timestamp: "2026-01-01T00:00:00.000Z",
      actor: "user-1",
      action: "cost_report",
      target: "gpt-5-mini, input",
      cost_usd: "1.5",
      tokens_input: 0,
      tokens_output: 0,
      raw_payload: {
        amount: { value: "1.5", currency: "usd" },
        line_item: "gpt-5-mini, input",
        project_id: "proj",
        user_id: "user-1",
        api_key_id: "key_1",
      },
      extra: {
        actorUserId: "user-1",
        apiKeyId: "key_1",
        [PULLED_USAGE_HINT_KEY]: {
          costBasis: "provider_reported",
          costStatus: "estimate",
          costUsd: "1.5",
          dimensions,
          model: "gpt-5-mini, input",
        },
      },
    });
  });
});

describe("run results", () => {
  describe("when a window read without key grouping drains", () => {
    it("advances one bucket past the watermark and asks to upgrade the grouping", () => {
      const result = drainedResult({
        events: [],
        cursor,
        watermark: "2026-01-05T00:00:00.000Z",
        hasKeyGrouping: false,
        query: "q",
        hasLostKeyAttribution: true,
      });

      expect(result).toEqual({
        events: [],
        cursor:
          '{"startingAt":"2026-01-06T00:00:00.000Z","page":null,"query":"q","watermark":null,' +
          '"hasKeyGrouping":true,"keyGroupingUpgrade":true}',
        errorCount: 0,
        notices: [PER_KEY_ATTRIBUTION_UNAVAILABLE],
      });
    });
  });

  describe("when a run stops short", () => {
    it("resumes a page token at the window it was minted against", () => {
      const result = stoppedShortResult({
        events: [],
        cursor,
        page: "tok",
        query: "q",
        watermark: null,
        hasKeyGrouping: true,
        hasLostKeyAttribution: false,
      });

      expect(result).toEqual({
        events: [],
        cursor:
          '{"startingAt":"2026-01-01T00:00:00.000Z","page":"tok","query":"q","watermark":null,' +
          '"hasKeyGrouping":true,"keyGroupingUpgrade":false}',
        errorCount: 0,
        completeness: "truncated",
      });
    });

    it("saves the start it was given, not the looked-back one, with no token in hand", () => {
      const result = stoppedShortResult({
        events: [],
        cursor,
        page: null,
        query: "q",
        watermark: null,
        hasKeyGrouping: true,
        hasLostKeyAttribution: false,
      });

      expect(JSON.parse(result.cursor ?? "{}")).toMatchObject({
        startingAt: "2026-01-04T00:00:00.000Z",
      });
    });
  });
});
