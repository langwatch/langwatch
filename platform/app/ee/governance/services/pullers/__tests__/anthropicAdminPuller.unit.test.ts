// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Anthropic Admin adapter — the first puller that produces priced usage
 * records rather than audit rows. The transport is stubbed; what is under test
 * is the bucket → record mapping and the two report paths ending in the two
 * different cost bases.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-088 (Decisions 6 and 7).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

// `vi.hoisted` so the mock factory can close over `fetchMock` — `vi.mock` is
// lifted above every declaration in the file, which is what forces the dynamic
// imports this replaces. With the double declared up here, the modules under
// test are ordinary top-level imports.
const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: (...args: unknown[]) => fetchMock(...args),
}));

import { AnthropicAdminPuller } from "../anthropicAdmin.puller";
import { buildPulledUsageRecord } from "../pulledUsageRecord";

const SOURCE = {
  ingestionSourceId: "src_1",
  sourceType: "anthropic_admin",
  organizationId: "org_acme",
  teamId: "team_platform",
};
const OBSERVED_AT = new Date("2026-08-06T09:00:00.000Z");

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
  };
}

const USAGE_PAGE = {
  data: [
    {
      starting_at: "2026-08-01T00:00:00Z",
      ending_at: "2026-08-02T00:00:00Z",
      results: [
        {
          uncached_input_tokens: 120_000,
          cache_creation_input_tokens: 1_000,
          cache_read_input_tokens: 4_000,
          output_tokens: 8_000,
          model: "anthropic/claude-sonnet-5",
          workspace_id: "ws_1",
          api_key_id: "key_1",
          service_tier: "standard",
        },
      ],
    },
  ],
  has_more: false,
  next_page: null,
};

const COST_PAGE = {
  data: [
    {
      starting_at: "2026-08-01T00:00:00Z",
      results: [
        {
          amount: "1234.567890123",
          currency: "USD",
          workspace_id: "ws_1",
          description: "Claude usage",
          cost_type: "tokens",
          model: "anthropic/claude-sonnet-5",
        },
      ],
    },
  ],
  has_more: false,
  next_page: null,
};

const RUN_OPTIONS = { cursor: null, credentials: { token: "sk-admin" } };

beforeEach(() => {
  fetchMock.mockReset();
});

describe("the Anthropic Admin puller", () => {
  describe("when the source pulls the usage report", () => {
    it("turns each bucket row into a self-priced estimate", async () => {
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));
      const puller = new AnthropicAdminPuller();

      const result = await puller.runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      expect(result.errorCount).toBe(0);
      expect(result.events).toHaveLength(1);

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costBasis).toBe("computed");
      expect(record?.costStatus).toBe("estimate");
      expect(record?.costNanoUsd).toBeGreaterThan(0);
      expect(record?.tokensInput).toBe(120_000);
      expect(record?.tokensCacheRead).toBe(4_000);
      expect(record?.tokensCacheWrite).toBe(1_000);
      expect(record?.occurredAtMs).toBe(Date.parse("2026-08-01T00:00:00Z"));
    });

    it("asks Anthropic to group by the dimensions the key is built from", async () => {
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));

      await new AnthropicAdminPuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain("usage_report/messages");
      expect(url).toContain("bucket_width=1d");
      expect(url).toContain("group_by%5B%5D=model");
      expect(url).toContain("group_by%5B%5D=workspace_id");
    });
  });

  describe("when the source pulls the cost report", () => {
    it("carries Anthropic's invoiced figure as an exact provider cost", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      const result = await new AnthropicAdminPuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costBasis).toBe("provider_reported");
      expect(record?.costStatus).toBe("exact");
      expect(record?.rateVersion).toBeNull();
      // Every digit Anthropic published survives to the integer, which is the
      // whole reason the exact string rides the hint next to the float.
      expect(record?.costNanoUsd).toBe(1_234_567_890_123);
    });

    it("drops a non-USD row rather than inventing a rate, and keeps the rest", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...COST_PAGE,
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [
                { ...COST_PAGE.data[0]!.results[0], currency: "EUR" },
                COST_PAGE.data[0]!.results[0],
              ],
            },
          ],
        }),
      );

      const result = await new AnthropicAdminPuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      // The unsupported row is gone and the USD row beside it survived. A
      // throw here would have unwound the whole run — and since the row is
      // non-USD on every retry, it would have wedged the source permanently.
      expect(result.events).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costNanoUsd).toBe(1_234_567_890_123);
    });

    it("asks for the daily bucket the cost report actually supports", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      await new AnthropicAdminPuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        // Deliberately not 1d: the cost report is daily-only, so the request
        // and the restatement key both have to ignore this.
        bucketWidth: "1h",
        schedule: "0 * * * *",
      });

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("bucket_width=1d");
    });

    it("keys a cost bucket identically however the source is configured", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));
      const puller = new AnthropicAdminPuller();
      const base = {
        adapter: "anthropic_admin" as const,
        report: "cost" as const,
        schedule: "0 * * * *",
      };

      const hourly = await puller.runOnce(RUN_OPTIONS, {
        ...base,
        bucketWidth: "1h",
      });
      const daily = await puller.runOnce(RUN_OPTIONS, {
        ...base,
        bucketWidth: "1d",
      });

      // An operator editing bucketWidth must not re-key unchanged cost
      // buckets; that would record the same spend a second time.
      const keyFor = (event: (typeof hourly.events)[number]) =>
        buildPulledUsageRecord({
          event,
          source: SOURCE,
          observedAt: OBSERVED_AT,
        })?.restatementKey;
      expect(keyFor(daily.events[0]!)).toBe(keyFor(hourly.events[0]!));
    });
  });

  describe("when the same bucket is pulled twice", () => {
    it("produces the same restatement key though the figure changed", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));
      const puller = new AnthropicAdminPuller();
      const config = {
        adapter: "anthropic_admin" as const,
        report: "cost" as const,
        bucketWidth: "1d" as const,
        schedule: "0 * * * *",
      };

      const first = await puller.runOnce(RUN_OPTIONS, config);

      fetchMock.mockResolvedValue(
        jsonResponse({
          ...COST_PAGE,
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...COST_PAGE.data[0]!.results[0], amount: "999.5" }],
            },
          ],
        }),
      );
      const corrected = await puller.runOnce(RUN_OPTIONS, config);

      const before = buildPulledUsageRecord({
        event: first.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });
      const after = buildPulledUsageRecord({
        event: corrected.events[0]!,
        source: SOURCE,
        observedAt: new Date("2026-08-07T09:00:00.000Z"),
      });

      expect(after?.restatementKey).toBe(before?.restatementKey);
      expect(after?.costNanoUsd).toBe(999_500_000_000);
    });
  });

  describe("when a page claims more pages but names none", () => {
    it("refuses, rather than advancing the watermark past what it never read", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ ...USAGE_PAGE, has_more: true, next_page: null }),
      );

      // Treating this as drained would move `startingAt` to the last bucket
      // read and the unread pages would never be fetched again — a window of
      // spend lost with nothing reporting a failure.
      await expect(
        new AnthropicAdminPuller().runOnce(RUN_OPTIONS, {
          adapter: "anthropic_admin",
          report: "usage",
          bucketWidth: "1d",
          schedule: "0 * * * *",
        }),
      ).rejects.toThrow(/has_more/);
    });
  });

  describe("when a provider value contains the identity delimiter", () => {
    it("keeps two distinct rows from collapsing onto one identity", async () => {
      const bucket = (description: string, costType: string) => ({
        starting_at: "2026-08-01T00:00:00Z",
        results: [
          {
            ...COST_PAGE.data[0]!.results[0],
            description,
            cost_type: costType,
          },
        ],
      });
      const puller = new AnthropicAdminPuller();
      const config = {
        adapter: "anthropic_admin" as const,
        report: "cost" as const,
        bucketWidth: "1d" as const,
        schedule: "0 * * * *",
      };

      // The delimiter moved across the description/costType boundary, so the
      // two rows join to the byte-identical string when nothing is encoded:
      // "…:a:b:c" either way. Both fields keep the same total colon count,
      // which is what makes this a true collision rather than a near miss.
      fetchMock.mockResolvedValue(
        jsonResponse({ ...COST_PAGE, data: [bucket("a:b", "c")] }),
      );
      const first = await puller.runOnce(RUN_OPTIONS, config);
      fetchMock.mockResolvedValue(
        jsonResponse({ ...COST_PAGE, data: [bucket("a", "b:c")] }),
      );
      const second = await puller.runOnce(RUN_OPTIONS, config);

      // `description` is free text Anthropic writes and can hold the ":" the
      // identity is joined on. Unencoded, these two distinct provider rows
      // produce one source_event_id — and that is the OCSF sink's dedup key.
      expect(second.events[0]!.source_event_id).not.toBe(
        first.events[0]!.source_event_id,
      );
    });
  });

  describe("when the transport fails", () => {
    it("leaves the cursor where it was so the window is retried", async () => {
      fetchMock.mockRejectedValue(new Error("connection reset"));

      const result = await new AnthropicAdminPuller().runOnce(
        {
          ...RUN_OPTIONS,
          cursor: '{"startingAt":"2026-08-01T00:00:00Z","page":null}',
        },
        {
          adapter: "anthropic_admin",
          report: "usage",
          bucketWidth: "1d",
          schedule: "0 * * * *",
        },
      );

      expect(result.errorCount).toBe(1);
      expect(result.cursor).toBe(
        '{"startingAt":"2026-08-01T00:00:00Z","page":null}',
      );
      expect(result.events).toHaveLength(0);
    });
  });

  describe("when the source has no admin key", () => {
    it("refuses to run, before reaching the network at all", async () => {
      const result = await new AnthropicAdminPuller().runOnce(
        { cursor: null },
        {
          adapter: "anthropic_admin",
          report: "usage",
          bucketWidth: "1d",
          schedule: "0 * * * *",
        },
      );

      expect(result.errorCount).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("when the config names both reports", () => {
    it("refuses on the report field itself, not on some incidental error", () => {
      let error: unknown;
      try {
        new AnthropicAdminPuller().validateConfig({
          adapter: "anthropic_admin",
          report: ["usage", "cost"],
        });
      } catch (thrown) {
        error = thrown;
      }

      // A bare `.toThrow()` would pass on any error at all, which would not
      // prove the exclusivity this asserts. Pin it to `report`: pulling both
      // reports would count the same spend twice (ADR-088 Decision 6).
      expect(error).toBeInstanceOf(ZodError);
      expect((error as ZodError).issues.map((i) => i.path.join("."))).toContain(
        "report",
      );
    });
  });
});
