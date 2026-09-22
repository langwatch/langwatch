import { INSTANT_EVAL_REQUEST_TYPE } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_SPEND_MODEL,
  instantEvalPricedSpend,
  instantEvalRateVersion,
  instantEvalSpendMetadata,
  instantEvalSpendRequestId,
  usdToNanoUsd,
  type InstantEvalSpendRecord,
} from "../instant-eval-spend-outcome.rules.ts";

const attribution = { organizationId: "org-1", teamId: "team-1" };

function record(overrides: Partial<InstantEvalSpendRecord> = {}): InstantEvalSpendRecord {
  return {
    projectId: "project-1",
    inputTokens: 12_000,
    requests: 40,
    costUsd: 0.01,
    priceUsd: 0.013,
    occurredAt: new Date("2026-09-22T10:00:00.000Z"),
    ...overrides,
  };
}

describe("instantEvalSpendRequestId", () => {
  it("derives a run's request id from the run, so a repeated finish lands on one event", () => {
    expect(instantEvalSpendRequestId({ runId: "instanteval_abc" })).toBe(
      "instanteval_instanteval_abc",
    );
    expect(instantEvalSpendRequestId({ runId: "r" })).toBe(
      instantEvalSpendRequestId({ runId: "r" }),
    );
  });

  it("mints a fresh id for a query, which has no durable resource to derive one from", () => {
    const first = instantEvalSpendRequestId({});

    expect(first).not.toBe(instantEvalSpendRequestId({}));
    expect(first.startsWith("instantevalquery")).toBe(true);
  });
});

describe("instantEvalRateVersion", () => {
  it("stamps the two published numbers, so a price change is visible on the row", () => {
    expect(instantEvalRateVersion({ usdPerMillionInputTokens: 0.8, markup: 1.3 })).toBe(
      "instant_eval@0.8x1.3",
    );
  });
});

describe("usdToNanoUsd", () => {
  it("rounds once, to the spine's own integer unit", () => {
    expect(usdToNanoUsd(0.013)).toBe(13_000_000);
    expect(Number.isInteger(usdToNanoUsd(1 / 3))).toBe(true);
  });
});

describe("instantEvalSpendMetadata", () => {
  it("carries our own cost and the request count, and the run when there is one", () => {
    expect(JSON.parse(instantEvalSpendMetadata(record({ runId: "run-1" })))).toEqual({
      instant_eval: { cost_usd: 0.01, requests: 40, run_id: "run-1" },
    });
  });

  it("names no run for a synchronous query", () => {
    expect(JSON.parse(instantEvalSpendMetadata(record()))).toEqual({
      instant_eval: { cost_usd: 0.01, requests: 40 },
    });
  });
});

describe("instantEvalPricedSpend", () => {
  it("puts the customer price on the record and our cost in the metadata beside it", () => {
    const priced = instantEvalPricedSpend({
      record: record({ runId: "run-1" }),
      attribution,
      requestId: "instanteval_run-1",
    });

    expect(priced.costNanoUsd).toBe(usdToNanoUsd(0.013));
    expect(JSON.parse(priced.metadata).instant_eval.cost_usd).toBe(0.01);
  });

  it("names the judgement's own request type and model, and the project's attribution", () => {
    const priced = instantEvalPricedSpend({
      record: record(),
      attribution,
      requestId: "req-1",
    });

    expect(priced).toMatchObject({
      requestId: "req-1",
      projectId: "project-1",
      organizationId: "org-1",
      teamId: "team-1",
      requestType: INSTANT_EVAL_REQUEST_TYPE,
      model: INSTANT_EVAL_SPEND_MODEL,
      inputTokens: 12_000,
      occurredAt: Date.parse("2026-09-22T10:00:00.000Z"),
    });
  });
});
