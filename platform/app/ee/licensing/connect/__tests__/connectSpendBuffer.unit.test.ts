import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstantEvalSpendRecord } from "~/server/app-layer/instant-evals/instant-eval-spend.recorder";
import { instantEvalSpendOutcome } from "~/server/app-layer/instant-evals/spend/instant-eval-spend.outcome";
import { ConnectSpendBuffer } from "../connectSpendBuffer";

const NOW = new Date("2026-09-19T12:00:00.000Z");

const entry = (virtualKeyId: string, inputTokens = 1000) => ({
  virtualKeyId,
  projectId: "proj_hidden",
  inputTokens,
  costUsd: inputTokens * 0.000000042,
  priceUsd: inputTokens * 0.0000000546,
});

function build({ failTimes = 0 }: { failTimes?: number } = {}) {
  const records: InstantEvalSpendRecord[] = [];
  let failures = failTimes;
  const buffer = new ConnectSpendBuffer({
    recorder: {
      recordSpend: async (record) => {
        if (failures-- > 0) throw new Error("spend pipeline is not registered");
        records.push(record);
      },
    },
    flushIntervalMs: 5_000,
    maxRequestsPerKey: 3,
    now: () => NOW,
  });
  return { buffer, records };
}

describe("ConnectSpendBuffer", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe("when several calls arrive under one managed key within the window", () => {
    /** @scenario Many classify calls are metered as one spend row per license */
    it("writes one record that sums them and says how many it covers", async () => {
      const { buffer, records } = build();

      buffer.add(entry("vk_a", 1000));
      buffer.add(entry("vk_a", 500));
      expect(records).toEqual([]);
      await vi.advanceTimersByTimeAsync(5_000);

      expect(records).toEqual([
        {
          projectId: "proj_hidden",
          virtualKeyId: "vk_a",
          inputTokens: 1500,
          requests: 2,
          costUsd: expect.closeTo(1500 * 0.000000042, 12),
          priceUsd: expect.closeTo(1500 * 0.0000000546, 12),
          occurredAt: NOW,
        },
      ]);
    });
  });

  describe("when two installs are judging at once", () => {
    it("keeps their spend apart, one record per managed key", async () => {
      const { buffer, records } = build();

      buffer.add(entry("vk_a"));
      buffer.add(entry("vk_b"));
      await buffer.flush();

      expect(records.map((record) => record.virtualKeyId).sort()).toEqual([
        "vk_a",
        "vk_b",
      ]);
    });
  });

  describe("when one key reaches the request limit before the window ends", () => {
    it("writes without waiting for the timer", async () => {
      const { buffer, records } = build();

      buffer.add(entry("vk_a"));
      buffer.add(entry("vk_a"));
      buffer.add(entry("vk_a"));
      await vi.advanceTimersByTimeAsync(0);

      expect(records).toMatchObject([{ requests: 3, inputTokens: 3000 }]);
    });
  });

  describe("when a write fails", () => {
    /** @scenario Spend that could not be written is kept and written later */
    it("keeps the spend and writes it with the next window", async () => {
      const { buffer, records } = build({ failTimes: 1 });

      buffer.add(entry("vk_a", 1000));
      await vi.advanceTimersByTimeAsync(5_000);
      expect(records).toEqual([]);
      buffer.add(entry("vk_a", 200));
      await vi.advanceTimersByTimeAsync(5_000);

      expect(records).toMatchObject([{ requests: 2, inputTokens: 1200 }]);
    });
  });

  describe("when the process shuts down with spend pending", () => {
    it("writes it on flush", async () => {
      const { buffer, records } = build();

      buffer.add(entry("vk_a"));
      await buffer.flush();

      expect(records).toHaveLength(1);
    });
  });

  describe("when a judgement billed no tokens", () => {
    it("writes nothing", async () => {
      const { buffer, records } = build();

      buffer.add(entry("vk_a", 0));
      await buffer.flush();

      expect(records).toEqual([]);
    });
  });
});

describe("the spend row of a hosted call", () => {
  it("names the managed key, is typed instant_eval, and carries the list price", () => {
    const outcome = instantEvalSpendOutcome({
      requestId: "req_1",
      input: {
        projectId: "proj_hidden",
        organizationId: "org_acme",
        teamId: "team_1",
        virtualKeyId: "vk_a",
        inputTokens: 1_000_000,
        requests: 40,
        costUsd: 0.042,
        priceUsd: 0.0546,
        occurredAt: NOW,
      },
    });

    expect(outcome).toMatchObject({
      virtual_key_id: "vk_a",
      organization_id: "org_acme",
      request_type: "instant_eval",
      cost_nano_usd: 54_600_000,
      tenantId: "proj_hidden",
    });
  });

  it("leaves the key empty for a query or a run inside LangWatch Cloud", () => {
    const outcome = instantEvalSpendOutcome({
      requestId: "req_2",
      input: {
        projectId: "proj_app",
        organizationId: "org_cloud",
        teamId: "team_2",
        inputTokens: 10,
        requests: 1,
        costUsd: 0,
        priceUsd: 0,
        occurredAt: NOW,
      },
    });

    expect(outcome.virtual_key_id).toBe("");
  });
});
