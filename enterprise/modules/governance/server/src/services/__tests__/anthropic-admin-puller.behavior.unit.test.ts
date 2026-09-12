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
import { inspect } from "node:util";
import type { PulledUsageRateInput } from "../../app/governance.members.ts";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { AnthropicAdminPullerAdapter } from "../anthropic-admin-puller.service.ts";
import {
  GovernanceHttpClient,
  type GovernanceHttpResponse,
} from "../../app/governance.members.ts";
import { PulledUsagePricingService } from "../pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../pulled-usage-record.service.ts";
import { Temporal } from "@langwatch/time";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));

class TestHttp implements GovernanceHttpClient {
  async fetch(
    url: string,
    init: Parameters<GovernanceHttpClient["fetch"]>[1],
  ): Promise<GovernanceHttpResponse> {
    return fetchMock(url, init);
  }
}

class TestRate {
  rate(input: PulledUsageRateInput) {
    return {
      costNanoUsd: input.quantities.tokensInput + input.quantities.tokensOutput > 0 ? 1 : 0,
      rateVersion: "test",
    };
  }
}

const pulledUsageRecords = PulledUsageRecordService.create(
  PulledUsagePricingService.create(new TestRate()),
);
const buildPulledUsageRecord = pulledUsageRecords.findBuilt.bind(pulledUsageRecords);

function makePuller(): AnthropicAdminPullerAdapter {
  return AnthropicAdminPullerAdapter.create(new TestHttp());
}

const SOURCE = {
  ingestionSourceId: "src_1",
  sourceType: "anthropic_admin",
  organizationId: "org_acme",
  teamId: "team_platform",
  createdAt: new Date("2026-07-01T00:00:00.000Z"),
};
/** The org's hidden governance project - where the row is stored (ADR-128). */
const GOV_PROJECT_ID = "proj_governance_acme";

const OBSERVED_AT = Temporal.Instant.from("2026-08-06T09:00:00.000Z");

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => body,
    text: async () => JSON.stringify(body),
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
          // The API's real shape: cache creation is NESTED, split by TTL.
          // There is no flat `cache_creation_input_tokens` field.
          cache_creation: {
            ephemeral_1h_input_tokens: 1_000,
            ephemeral_5m_input_tokens: 500,
          },
          cache_read_input_tokens: 4_000,
          output_tokens: 8_000,
          model: "anthropic/claude-sonnet-5",
          workspace_id: "ws_1",
          api_key_id: "key_1",
          service_tier: "standard",
          context_window: "0-200k",
        },
      ],
    },
  ],
  has_more: false,
  next_page: null,
};

// `amount` is denominated in CENTS ("lowest currency units"), per the docs:
// "41280.000000" in USD is $412.80.
const COST_PAGE = {
  data: [
    {
      starting_at: "2026-08-01T00:00:00Z",
      results: [
        {
          amount: "41280.000000",
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
      const puller = makePuller();

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
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costBasis).toBe("computed");
      expect(record?.costStatus).toBe("estimate");
      expect(record?.costNanoMinor).toBeGreaterThan(0);
      expect(record?.tokensInput).toBe(120_000);
      expect(record?.tokensCacheRead).toBe(4_000);
      // Both TTL variants of the nested `cache_creation` object count as
      // cache-write tokens. The old flat-field schema read this as 0 and the
      // `.default(0)` masked the shape mismatch.
      expect(record?.tokensCacheWrite).toBe(1_500);
      expect(record?.occurredAtMs).toBe(Date.parse("2026-08-01T00:00:00Z"));
    });

    it("asks Anthropic to group by the dimensions the key is built from", async () => {
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));

      await makePuller().runOnce(RUN_OPTIONS, {
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
      // The API returns null for any field not in group_by, so a dimension
      // that rides the key MUST also be asked for — otherwise serviceTier and
      // contextWindow are always "", and batch / long-context usage collapses
      // onto standard usage under one key.
      expect(url).toContain("group_by%5B%5D=service_tier");
      expect(url).toContain("group_by%5B%5D=context_window");
    });

    it("keys rows differing only by context window apart", async () => {
      const row = USAGE_PAGE.data[0]!.results[0]!;
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...USAGE_PAGE,
          data: [
            {
              ...USAGE_PAGE.data[0]!,
              results: [row, { ...row, context_window: "200k-1M" }],
            },
          ],
        }),
      );

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      // Long-context usage is priced differently, so the two rows must not
      // collapse onto one identity (source_event_id is the OCSF dedup key).
      expect(result.events).toHaveLength(2);
      expect(result.events[0]!.source_event_id).not.toBe(result.events[1]!.source_event_id);
    });

    it("keys rows differing only by service tier apart", async () => {
      const row = USAGE_PAGE.data[0]!.results[0]!;
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...USAGE_PAGE,
          data: [
            {
              ...USAGE_PAGE.data[0]!,
              results: [row, { ...row, service_tier: "batch" }],
            },
          ],
        }),
      );

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      // Batch usage is priced differently from standard, so service tier must
      // participate in identity the same way context window does.
      expect(result.events).toHaveLength(2);
      expect(result.events[0]!.source_event_id).not.toBe(result.events[1]!.source_event_id);
    });

    it("falls back to the legacy flat cache-creation field when the nested object is absent", async () => {
      const { cache_creation: _nested, ...row } = USAGE_PAGE.data[0]!.results[0]!;
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...USAGE_PAGE,
          data: [
            {
              ...USAGE_PAGE.data[0]!,
              results: [{ ...row, cache_creation_input_tokens: 2_345 }],
            },
          ],
        }),
      );

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "usage",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      expect(record?.tokensCacheWrite).toBe(2_345);
    });
  });

  describe("when the source pulls the cost report", () => {
    it("converts Anthropic's cents figure to USD at the boundary", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costBasis).toBe("provider_reported");
      // Not "exact": the cost report excludes Priority Tier usage, so it is
      // Anthropic's own figure but not the full invoice.
      expect(record?.costStatus).toBe("estimate");
      expect(record?.rateVersion).toBeNull();
      // The documented worked example: `amount` is denominated in cents, so
      // "41280.000000" is $412.80 — not $41,280. Stored verbatim it was 100x.
      expect(record?.costNanoMinor).toBe(412_800_000_000);
    });

    it("names nobody, because the cost report carries no person to name", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      const result = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      // Deliberate, and the opposite of the OpenAI sibling, whose cost rows do
      // name a person. Anthropic groups this report by workspace and
      // description only — there is no user dimension to ask for — so an actor
      // here could only be invented. Blank is what person discovery skips.
      expect(result.events[0]?.actor).toBe("");
    });

    /** @scenario "A provider amount in minor units becomes the correct dollar amount" */
    it("reads 1234 minor units as twelve dollars and thirty-four cents", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...COST_PAGE,
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...COST_PAGE.data[0]!.results[0], amount: "1234" }],
            },
          ],
        }),
      );

      const result = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });

      // $12.34, not $1,234. The 100x bug class (#6977) is a provider's minor
      // units stored as if they were the major ones.
      expect(record?.costNanoMinor).toBe(12_340_000_000);
    });

    it("shifts the decimal point without passing through a float", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...COST_PAGE,
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...COST_PAGE.data[0]!.results[0], amount: "1234.567890123" }],
            },
          ],
        }),
      );

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      // 1234.567890123 cents = $12.34567890123; every digit nano-USD can hold
      // survives, the sub-nano tail rounds half away from zero.
      expect(record?.costNanoMinor).toBe(12_345_678_901);
    });

    it("survives an exponent-form amount from the schema's number branch", async () => {
      // JSON.stringify never emits this, but the amount schema accepts raw
      // numbers, and String(1e-7) is "1e-7" — the one input class the digit
      // shift can't handle by slicing. It must convert, not throw: a throw
      // here holds the cursor and replays forever.
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...COST_PAGE,
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [{ ...COST_PAGE.data[0]!.results[0], amount: 1e-7 }],
            },
          ],
        }),
      );

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      // 1e-7 cents = 1e-9 USD = exactly one nano-USD.
      expect(record?.costNanoMinor).toBe(1);
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

      const result = await makePuller().runOnce(RUN_OPTIONS, {
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
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costNanoMinor).toBe(412_800_000_000);
    });

    it("drops a malformed amount row rather than aborting the pull", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          ...COST_PAGE,
          data: [
            {
              starting_at: "2026-08-01T00:00:00Z",
              results: [
                { ...COST_PAGE.data[0]!.results[0], amount: "not-a-number" },
                // An exponent past Number's safe-integer range would collapse
                // to Infinity and emit "eInfinity" — malformed, not money.
                {
                  ...COST_PAGE.data[0]!.results[0],
                  amount: `1e${"9".repeat(309)}`,
                },
                COST_PAGE.data[0]!.results[0],
              ],
            },
          ],
        }),
      );

      const result = await makePuller().runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });

      // Same blast-radius call as the non-USD row: the malformed row would be
      // malformed again on every retry, so a throw would wedge the source
      // permanently. One bad row costs one row.
      expect(result.events).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costNanoMinor).toBe(412_800_000_000);
    });

    it("asks for the daily bucket the cost report actually supports", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      await makePuller().runOnce(RUN_OPTIONS, {
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
      const puller = makePuller();
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
          governanceProjectId: GOV_PROJECT_ID,
          observedAt: OBSERVED_AT,
        })?.restatementKey;
      expect(keyFor(daily.events[0]!)).toBe(keyFor(hourly.events[0]!));
    });
  });

  describe("when the same bucket is pulled twice", () => {
    it("produces the same restatement key though the figure changed", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));
      const puller = makePuller();
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
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      const after = buildPulledUsageRecord({
        event: corrected.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: Temporal.Instant.from("2026-08-07T09:00:00.000Z"),
      });

      // 999.5 cents = $9.995.
      expect(after?.restatementKey).toBe(before?.restatementKey);
      expect(after?.costNanoMinor).toBe(9_995_000_000);
    });
  });

  describe("when the query the cursor was minted under changes", () => {
    // Anthropic returns 400 when a page token is replayed with changed query
    // params, and the puller holds the cursor still on failure — so a config
    // edit would wedge the source: every retry replays the same dead token.
    const config = {
      adapter: "anthropic_admin" as const,
      report: "usage" as const,
      schedule: "0 * * * *",
      startingAt: "2026-08-01T00:00:00.000Z",
    };

    /**
     * A cursor persisted mid-window, holding a live page token: every page
     * claims another, so the run exhausts MAX_PAGES_PER_RUN and returns with
     * the token still in hand.
     */
    async function midWindowCursor(puller: AnthropicAdminPullerAdapter) {
      fetchMock.mockResolvedValue(
        jsonResponse({ ...USAGE_PAGE, has_more: true, next_page: "page_2" }),
      );
      const run = await puller.runOnce(RUN_OPTIONS, {
        ...config,
        bucketWidth: "1d",
      });
      if (!run.cursor?.includes("page_2")) {
        throw new Error(`expected a mid-window cursor holding page_2, got ${String(run.cursor)}`);
      }
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));
      return run.cursor;
    }

    it("keeps replaying Anthropic's page token while the query is unchanged", async () => {
      const puller = makePuller();
      const cursor = await midWindowCursor(puller);

      await puller.runOnce({ ...RUN_OPTIONS, cursor }, { ...config, bucketWidth: "1d" });

      // Same config → the mid-window token is safe to replay.
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("page=page_2");
    });

    it("resumes a config-edited usage source from the newest bucket it emitted, not the window start", async () => {
      const puller = makePuller();
      const cursor = await midWindowCursor(puller);

      await puller.runOnce({ ...RUN_OPTIONS, cursor }, { ...config, bucketWidth: "1h" });

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).not.toContain("page=");
      // Usage identity embeds the config bucket width, so everything re-read
      // under the new query is emitted under NEW keys beside the old rows —
      // duplicated spend, not restatement. Restarting the window at its
      // start would re-read every page already emitted, so the resume point
      // is the in-window watermark the cut-off run recorded (the bucket's
      // `starting_at`, not the window's `2026-08-01T00:00:00.000Z` start):
      // at most one bucket is re-read.
      expect(url).toContain(`starting_at=${encodeURIComponent("2026-08-01T00:00:00Z")}`);
    });

    it("records the newest bucket emitted beside the page token when a run is cut off", async () => {
      const puller = makePuller();

      const cursor = await midWindowCursor(puller);

      // The window start alone says where the window BEGAN, not how far the
      // run got — resuming a stale cursor from it re-reads the whole window.
      expect(JSON.parse(cursor)).toMatchObject({
        startingAt: "2026-08-01T00:00:00.000Z",
        page: "page_2",
        watermark: "2026-08-01T00:00:00Z",
      });
    });

    it("carries the recorded watermark through a resumed run cut off before its first page", async () => {
      const puller = makePuller();
      const cursor = await midWindowCursor(puller);

      const run = await puller.runOnce(
        { ...RUN_OPTIONS, cursor, deadlineMs: Date.now() - 1 },
        { ...config, bucketWidth: "1d" },
      );

      // A deadline that fires before any page is read must not blank the
      // watermark the previous run recorded — that would silently widen the
      // stale-cursor re-read back to the whole window.
      expect(JSON.parse(run.cursor!)).toMatchObject({
        page: "page_2",
        watermark: "2026-08-01T00:00:00Z",
      });
    });

    it("holds the cost window still when run after run is cut off before reading a page", async () => {
      // A drained cost cursor carries no page token, and `parseCursor` gives
      // exactly those cursors the repair look-back — so the window a run ASKS
      // from sits earlier than the position on record. Saving the asked-from
      // value when the deadline fires before page one would hand the next run
      // an already-rewound position to look back from again, and each cut-off
      // run would walk the window further into the past. With no page token
      // there is nothing to resume, so the position on record is saved.
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));
      const puller = new AnthropicAdminPullerAdapter();
      const costConfig = {
        adapter: "anthropic_admin" as const,
        report: "cost" as const,
        bucketWidth: "1d" as const,
        schedule: "0 * * * *",
        startingAt: "2026-08-01T00:00:00.000Z",
      };

      const drained = await puller.runOnce(RUN_OPTIONS, costConfig);
      const drainedPosition = JSON.parse(drained.cursor!) as {
        startingAt: string;
        page: string | null;
      };
      expect(drainedPosition.page).toBeNull();

      let cursor = drained.cursor!;
      const positions: string[] = [];
      for (let run = 0; run < 3; run += 1) {
        const cutOff = await puller.runOnce(
          { ...RUN_OPTIONS, cursor, deadlineMs: Date.now() - 1 },
          costConfig,
        );
        cursor = cutOff.cursor!;
        positions.push(
          (JSON.parse(cursor) as { startingAt: string }).startingAt,
        );
      }

      expect(positions).toEqual([
        drainedPosition.startingAt,
        drainedPosition.startingAt,
        drainedPosition.startingAt,
      ]);
    });

    it("keeps a pre-query-binding usage watermark rather than rewinding into duplicates", async () => {
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));

      await makePuller().runOnce(
        {
          ...RUN_OPTIONS,
          // A cursor persisted by the previous version: no query identity
          // and no in-window watermark. Its page token would 400 against the
          // widened group_by, so it goes — and with no record of how far the
          // cut-off run got, the resume point falls back to the window
          // start. That re-reads the in-flight window (bounded by
          // MAX_PAGES_PER_RUN) under the new usage identity, duplicating
          // those buckets ONCE — accepted over skipping the rest of the
          // window. It must not reach further back than that: rewinding to
          // the configured start would double-count all history.
          cursor: '{"startingAt":"2026-08-01T00:00:00Z","page":"page_stale"}',
        },
        {
          adapter: "anthropic_admin",
          report: "usage",
          bucketWidth: "1d",
          schedule: "0 * * * *",
          startingAt: "2026-07-01T00:00:00.000Z",
        },
      );

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).not.toContain("page=");
      // NOT rewound to the configured start — the watermark is kept.
      expect(url).toContain(`starting_at=${encodeURIComponent("2026-08-01T00:00:00Z")}`);
    });

    it("falls back to the configured start when a kept usage watermark is not a date", async () => {
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));

      await makePuller().runOnce(
        {
          ...RUN_OPTIONS,
          // A corrupt watermark certifies no history, so falling back
          // duplicates nothing — while passing it through as `starting_at`
          // would 400 on every retry forever (the cursor holds still on
          // failure).
          cursor: '{"startingAt":"not-a-date","page":"page_stale"}',
        },
        {
          adapter: "anthropic_admin",
          report: "usage",
          bucketWidth: "1d",
          schedule: "0 * * * *",
          startingAt: "2026-07-01T00:00:00.000Z",
        },
      );

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).not.toContain("page=");
      expect(url).toContain(`starting_at=${encodeURIComponent("2026-07-01T00:00:00.000Z")}`);
    });

    it("never rewinds a cost source FORWARD: a backlogged watermark older than the configured start survives", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      await makePuller().runOnce(
        {
          ...RUN_OPTIONS,
          // A cost source that fell behind: legacy cursor, watermark months
          // old. No configured startingAt, so the rewind target would default
          // to ~3 days ago — snapping forward would silently skip the backlog.
          cursor: '{"startingAt":"2026-06-01T00:00:00Z","page":null}',
        },
        {
          adapter: "anthropic_admin",
          report: "cost",
          bucketWidth: "1d",
          schedule: "0 * * * *",
        },
      );

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain(`starting_at=${encodeURIComponent("2026-06-01T00:00:00Z")}`);
    });

    it("rewinds a drained cost cursor from the 100x era so restatement can repair it", async () => {
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      const result = await makePuller().runOnce(
        {
          ...RUN_OPTIONS,
          // A mature source: drained (no page token), watermark well past the
          // buckets whose costs were stored 100x. Keeping the watermark would
          // strand those rows forever — no scheduled run ever re-reads them.
          cursor: '{"startingAt":"2026-08-05T00:00:00Z","page":null,"query":null}',
        },
        {
          adapter: "anthropic_admin",
          report: "cost",
          bucketWidth: "1d",
          schedule: "0 * * * *",
          startingAt: "2026-07-01T00:00:00.000Z",
        },
      );

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain(`starting_at=${encodeURIComponent("2026-07-01T00:00:00.000Z")}`);
      // The re-pulled bucket keeps its stable identity, so the corrected
      // figure supersedes the 100x row instead of sitting beside it.
      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        governanceProjectId: GOV_PROJECT_ID,
        observedAt: OBSERVED_AT,
      });
      expect(record?.costNanoMinor).toBe(412_800_000_000);
      // And the rewind runs once: the freshly minted cursor carries the
      // current query identity.
      expect(JSON.parse(result.cursor ?? "{}").query).toContain("cost:");
    });

    it("rewinds a cost source again when startingAt is widened after its first run", async () => {
      // The legacy-source remediation: a source with no configured
      // `startingAt` first repairs only the default window, THEN the operator
      // sets a deeper start. The configured start is part of the cost cursor
      // identity, so the edit mints a mismatch and the rewind fires once more
      // — without this, the cursor would match forever and the deeper 100x
      // rows would be unreachable short of deleting the cursor by hand.
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));
      const puller = makePuller();

      const firstRun = await puller.runOnce(RUN_OPTIONS, {
        adapter: "anthropic_admin",
        report: "cost",
        bucketWidth: "1d",
        schedule: "0 * * * *",
      });
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      await puller.runOnce(
        { ...RUN_OPTIONS, cursor: firstRun.cursor },
        {
          adapter: "anthropic_admin",
          report: "cost",
          bucketWidth: "1d",
          schedule: "0 * * * *",
          startingAt: "2026-01-01T00:00:00.000Z",
        },
      );

      const url = String(fetchMock.mock.calls[0]?.[0]);
      expect(url).toContain(`starting_at=${encodeURIComponent("2026-01-01T00:00:00.000Z")}`);
    });

    it("keeps replaying a cost page token while the config is unchanged", async () => {
      // Guards the identity's stability: what `runOnce` mints must be what
      // `parseCursor` computes for the same config, or every scheduled run
      // would discard its cursor and re-read from the start.
      fetchMock.mockResolvedValue(
        jsonResponse({ ...COST_PAGE, has_more: true, next_page: "page_2" }),
      );
      const puller = makePuller();
      const costConfig = {
        adapter: "anthropic_admin" as const,
        report: "cost" as const,
        bucketWidth: "1d" as const,
        schedule: "0 * * * *",
        startingAt: "2026-08-01T00:00:00.000Z",
      };

      const firstRun = await puller.runOnce(RUN_OPTIONS, costConfig);
      if (!firstRun.cursor?.includes("page_2")) {
        throw new Error(
          `expected a mid-window cursor holding page_2, got ${String(firstRun.cursor)}`,
        );
      }
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse(COST_PAGE));

      await puller.runOnce({ ...RUN_OPTIONS, cursor: firstRun.cursor }, costConfig);

      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("page=page_2");
    });
  });

  describe("when a page claims more pages but names none", () => {
    it("refuses, rather than advancing the watermark past what it never read", async () => {
      fetchMock.mockResolvedValue(jsonResponse({ ...USAGE_PAGE, has_more: true, next_page: null }));

      // Treating this as drained would move `startingAt` to the last bucket
      // read and the unread pages would never be fetched again — a window of
      // spend lost with nothing reporting a failure.
      await expect(
        makePuller().runOnce(RUN_OPTIONS, {
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
      const puller = makePuller();
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
      fetchMock.mockResolvedValue(jsonResponse({ ...COST_PAGE, data: [bucket("a:b", "c")] }));
      const first = await puller.runOnce(RUN_OPTIONS, config);
      fetchMock.mockResolvedValue(jsonResponse({ ...COST_PAGE, data: [bucket("a", "b:c")] }));
      const second = await puller.runOnce(RUN_OPTIONS, config);

      // `description` is free text Anthropic writes and can hold the ":" the
      // identity is joined on. Unencoded, these two distinct provider rows
      // produce one source_event_id — and that is the OCSF sink's dedup key.
      expect(second.events[0]!.source_event_id).not.toBe(first.events[0]!.source_event_id);
    });
  });

  describe("when the transport fails", () => {
    it("preserves the provider's rate-limit wait for the durable retry without leaking the response body", async () => {
      fetchMock.mockResolvedValue(
        new Response("private upstream payload", {
          status: 429,
          headers: { "retry-after": "120" },
        }),
      );
      await expect(
        new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, {
          adapter: "anthropic_admin",
          report: "cost",
          bucketWidth: "1d",
          schedule: "0 * * * *",
        }),
      ).rejects.toMatchObject({
        message: "Anthropic rate limit exceeded (HTTP 429).",
        retryAfterMs: 120_000,
      });
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("still reports the rate-limit wait when draining the body fails", async () => {
      // Cancelling the body is housekeeping for the connection pool. An
      // already-errored stream rejects it, and unguarded that rejection leaves
      // the 429 branch INSTEAD of the DispatchError — the caller's
      // `instanceof DispatchError` guard then fails and the wait is gone. A
      // real Response resolves cancel(), so the rejection has to be planted.
      const response = new Response("private upstream payload", {
        status: 429,
        headers: { "retry-after": "120" },
      });
      Object.defineProperty(response, "body", {
        value: {
          cancel: () => Promise.reject(new Error("stream already errored")),
        },
      });
      fetchMock.mockResolvedValue(response);

      await expect(
        new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, {
          adapter: "anthropic_admin",
          report: "cost",
          bucketWidth: "1d",
          schedule: "0 * * * *",
        }),
      ).rejects.toMatchObject({
        message: "Anthropic rate limit exceeded (HTTP 429).",
        retryAfterMs: 120_000,
      });
    });

    it("leaves the cursor where it was so the window is retried", async () => {
      fetchMock.mockRejectedValue(new Error("connection reset"));

      const result = await makePuller().runOnce(
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
      expect(result.cursor).toBe('{"startingAt":"2026-08-01T00:00:00Z","page":null}');
      expect(result.events).toHaveLength(0);
    });
  });

  describe("when the provider refuses the admin key", () => {
    const CONFIG = {
      adapter: "anthropic_admin",
      report: "cost",
      bucketWidth: "1d",
      schedule: "0 * * * *",
    } as const;

    // The body the provider is made to refuse with. Every fragment is a fake,
    // and each is distinctive enough that finding it anywhere in the thrown
    // error can only mean the reply was quoted: a key-shaped string, the
    // workspace it names, and the provider's own error prose.
    const REFUSAL_KEY = "sk-ant-admin-FAKE000";
    const REFUSAL_WORKSPACE = "wrkspc_QUOTED_BODY_MARKER";
    const REFUSAL_PROSE = "authentication_error";
    const REFUSAL_BODY = JSON.stringify({
      error: {
        type: REFUSAL_PROSE,
        message: `invalid x-api-key ${REFUSAL_KEY} for workspace ${REFUSAL_WORKSPACE}`,
      },
    });

    /** @scenario "A key the provider refuses is reported as refused and is not retried as an outage" */
    it.each([
      401, 403,
    ])("ends the run as refused and not worth retrying on HTTP %i, without quoting the reply or the key", async (status) => {
      fetchMock.mockResolvedValue(new Response(REFUSAL_BODY, { status }));

      const run = new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, CONFIG);
      await expect(run).rejects.toBeInstanceOf(DispatchError);
      await expect(run).rejects.toMatchObject({
        retryable: false,
        message: `HTTP ${status} (anthropic cost_report): key refused`,
        customerMessage:
          "Anthropic refused this key. Check the admin key and its permissions.",
      });
      // `run` is typed by its resolved value, so the rejection has to be read
      // off the promise and cast: the assertions above already proved what it is.
      const error = (await run.catch((e: unknown) => e)) as DispatchError;
      // Three surfaces, because the reply reaches a person through any of
      // them: the log line (`message`), the sentence an admin is shown
      // (`customerMessage`), and whatever a log serialiser writes down. The
      // last is rendered with `util.inspect`, which walks own properties,
      // `stack` and a `cause` to any depth — so a body tucked inside an
      // object-valued `cause` is caught rather than flattened away.
      const serialised = inspect(error, { depth: null, showHidden: true });
      for (const fragment of [REFUSAL_KEY, REFUSAL_WORKSPACE, REFUSAL_PROSE]) {
        expect(error.message).not.toContain(fragment);
        expect(error.customerMessage).not.toContain(fragment);
        expect(serialised).not.toContain(fragment);
      }
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("still treats a server fault as a transport failure that holds the cursor for a retry", async () => {
      fetchMock.mockResolvedValue(
        new Response("upstream fell over", { status: 500 }),
      );

      const result = await new AnthropicAdminPullerAdapter().runOnce(
        {
          ...RUN_OPTIONS,
          cursor: '{"startingAt":"2026-08-01T00:00:00Z","page":null}',
        },
        CONFIG,
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
      const result = await makePuller().runOnce(
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
        makePuller().validateConfig({
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
      expect((error as ZodError).issues.map((i) => i.path.join("."))).toContain("report");
    });
  });

  describe("when a page returns its buckets out of order", () => {
    const USAGE_ROW = USAGE_PAGE.data[0]!.results[0]!;
    /**
     * Newest in the MIDDLE, oldest last. Anthropic promises no order within a
     * page, and reading the last element as the newest gets 2026-08-01 here —
     * behind two buckets this very run already emitted.
     */
    const OUT_OF_ORDER = [
      { starting_at: "2026-08-02T00:00:00Z", results: [USAGE_ROW] },
      { starting_at: "2026-08-03T00:00:00Z", results: [USAGE_ROW] },
      { starting_at: "2026-08-01T00:00:00Z", results: [USAGE_ROW] },
    ];
    const config = {
      adapter: "anthropic_admin" as const,
      report: "usage" as const,
      bucketWidth: "1d" as const,
      schedule: "0 * * * *",
      startingAt: "2026-08-01T00:00:00.000Z",
    };

    it("resumes a drained window from the newest bucket, not the last one in the array", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: OUT_OF_ORDER, has_more: false, next_page: null }),
      );

      const run = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, config);

      // The last element would send the next run back to 2026-08-01 and
      // re-read two buckets. Under an unchanged query that re-read restates
      // (the id is `usage:<bucket>:<dimensions>`, so it lands on the same
      // key) — the cost is a window that stops advancing, and duplication
      // only once the query identity changes and the keys move with it.
      expect(run.events).toHaveLength(3);
      expect(JSON.parse(run.cursor!)).toMatchObject({
        startingAt: "2026-08-03T00:00:00Z",
        watermark: null,
      });
    });

    it("records the newest bucket as the in-window watermark when the run is cut off", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({ data: OUT_OF_ORDER, has_more: true, next_page: "p2" }),
      );

      const run = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, config);

      // The watermark is what a later query-identity mismatch resumes from,
      // so an understated one widens the re-read it exists to bound.
      expect(JSON.parse(run.cursor!)).toMatchObject({
        page: "p2",
        watermark: "2026-08-03T00:00:00Z",
      });
    });

    it("resumes a drained window from the newest bucket across pages, not the last page's", async () => {
      // Each page is internally ordered, so the per-page maximum is not what
      // is being tested: page two's newest bucket is simply OLDER than page
      // one's. Anthropic promises no order across pages either, and taking
      // the last page's maximum would mint 2026-08-02 and hand the next run
      // a window start behind buckets this one already emitted — which, if
      // the provider's page order is stable, it would then re-mint forever.
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              { starting_at: "2026-08-04T00:00:00Z", results: [USAGE_ROW] },
              { starting_at: "2026-08-05T00:00:00Z", results: [USAGE_ROW] },
            ],
            has_more: true,
            next_page: "p2",
          }),
        )
        .mockResolvedValueOnce(
          jsonResponse({
            data: [
              { starting_at: "2026-08-01T00:00:00Z", results: [USAGE_ROW] },
              { starting_at: "2026-08-02T00:00:00Z", results: [USAGE_ROW] },
            ],
            has_more: false,
            next_page: null,
          }),
        );

      const run = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, config);

      expect(run.events).toHaveLength(4);
      expect(JSON.parse(run.cursor!)).toMatchObject({
        startingAt: "2026-08-05T00:00:00Z",
        watermark: null,
      });
    });
  });

  describe("when one page holds two rows the cost key cannot tell apart", () => {
    const COST_ROW = COST_PAGE.data[0]!.results[0]!;
    const config = {
      adapter: "anthropic_admin" as const,
      report: "cost" as const,
      bucketWidth: "1d" as const,
      schedule: "0 * * * *",
    };
    /** One bucket, whose rows differ only outside the key. */
    function pageWith(rows: unknown[]) {
      return {
        data: [{ starting_at: "2026-08-01T00:00:00Z", results: rows }],
        has_more: false,
        next_page: null,
      };
    }

    it("refuses the page rather than letting the second row overwrite the first", async () => {
      // `model` is parsed by `costResultSchema` and is NOT a cost dimension,
      // so these two rows join to one `source_event_id` — the sink's dedup
      // key — and only the last one written survives.
      fetchMock.mockResolvedValue(
        jsonResponse(
          pageWith([
            { ...COST_ROW, model: "anthropic/claude-sonnet-5" },
            {
              ...COST_ROW,
              model: "anthropic/claude-opus-5",
              amount: "10000.000000",
            },
          ]),
        ),
      );

      let error: unknown;
      try {
        await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, config);
      } catch (thrown) {
        error = thrown;
      }

      // A plain Error, not a HandledError: nobody outside can act on a
      // provider contract that moved.
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).name).toBe("Error");
      const message = (error as Error).message;
      // The count and the key's dimension NAMES, so an operator can see which
      // coordinates failed to separate the rows.
      expect(message).toContain("1 restatement key");
      expect(message).toContain("workspaceId");
      expect(message).toContain("costType");
      // …and none of the values, which are customer billing coordinates and
      // money. This string reaches logs and the source's error state.
      //
      // The money has to be named in the form the code would actually emit.
      // `amount` arrives in CENTS, so the fixture rows carry "41280.000000"
      // and "10000.000000": asserting only the dollar conversions would let
      // an implementation interpolate the raw provider string and still pass,
      // which is a guard that cannot fail. Both forms are listed, plus the
      // bare integers, so neither the pre- nor the post-conversion value can
      // slip through.
      for (const value of [
        "ws_1",
        "Claude usage",
        "claude-opus-5",
        "41280.000000",
        "10000.000000",
        "41280",
        "10000",
        "412.80",
        "100.00",
      ]) {
        expect(message).not.toContain(value);
      }
    });

    /** @scenario "A refused Anthropic collision names the fields the two rows differed in" */
    it("names the field outside the key that the two rows differed in", async () => {
      // Same day, workspace, description and model — so the same key — and a
      // different amount, so the guard already refuses. What the operator
      // could not see was WHY the provider split the row: the tier sat on
      // the stored row all along, and the message never named it.
      fetchMock.mockResolvedValue(
        jsonResponse(
          pageWith([
            { ...COST_ROW, service_tier: "standard" },
            {
              ...COST_ROW,
              service_tier: "priority",
              amount: "10000.000000",
            },
          ]),
        ),
      );

      let error: unknown;
      let run: unknown;
      try {
        run = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, config);
      } catch (thrown) {
        error = thrown;
      }

      // Refused, and nothing from the page recorded: the run never returns a
      // result, so no event reaches the sink.
      expect(error).toBeInstanceOf(Error);
      expect(run).toBeUndefined();

      const message = (error as Error).message;
      // The lead: the provider's own name for the coordinate it split on.
      expect(message).toContain("service_tier");
      // The key it already named is still there — this adds to the message,
      // it does not replace it.
      expect(message).toContain("1 restatement key");
      expect(message).toContain("workspaceId");
      expect(message).toContain("costType");
      // Names only. The tier VALUES are provider billing coordinates and this
      // string reaches logs and the source's error state.
      for (const value of ["standard", "priority", "ws_1", "Claude usage"]) {
        expect(message).not.toContain(value);
      }
    });

    it("leaves the key alone when a row carries the differing field", async () => {
      // The refusal names the field; it must not be answered by widening the
      // key. A key that carried the tier would re-key every cost cell already
      // stored, so a later correction would land beside the figure it
      // corrects instead of replacing it.
      async function keyForTier(tier: string): Promise<string> {
        fetchMock.mockResolvedValue(
          jsonResponse(pageWith([{ ...COST_ROW, service_tier: tier }])),
        );
        const run = await new AnthropicAdminPullerAdapter().runOnce(
          RUN_OPTIONS,
          config,
        );
        return run.events[0]!.source_event_id;
      }

      expect(await keyForTier("standard")).toBe(await keyForTier("priority"));
    });

    it("accepts a row the provider repeated with the same amount", async () => {
      fetchMock.mockResolvedValue(jsonResponse(pageWith([COST_ROW, COST_ROW])));

      const run = await new AnthropicAdminPullerAdapter().runOnce(RUN_OPTIONS, config);

      // Same key, same money: whichever survives the upsert the figure
      // recorded is identical, so a repeat costs nothing and must not fail a
      // window of real spend.
      expect(run.errorCount).toBe(0);
      expect(run.events).toHaveLength(2);
      expect(run.events[0]!.source_event_id).toBe(
        run.events[1]!.source_event_id,
      );
    });
  });
});

/**
 * Reading back over a window the provider may still correct.
 *
 * The sibling OpenAI adapter already re-reads a few days behind its watermark
 * and floors that at the configured start (`windowStartFor`). This adapter
 * read strictly forward, so the first figure it ever saw for a day was the
 * last one it would ever hold — and that figure disagreed with the provider's
 * own console within a week.
 *
 * Every run below mints its cursor by running once, rather than hand-writing
 * one: the cost cursor's identity embeds the configured start, so a
 * hand-written cursor would take the stale-cursor rewind path instead of the
 * look-back path these scenarios are about.
 */
describe("given an Anthropic cost source that has already read up to a day", () => {
  /** One page whose only bucket starts where the caller says. */
  function costPageStartingAt(bucketStart: string) {
    return {
      ...COST_PAGE,
      data: [{ ...COST_PAGE.data[0]!, starting_at: bucketStart }],
    };
  }

  function costConfig(startingAt: string) {
    return {
      adapter: "anthropic_admin" as const,
      report: "cost" as const,
      bucketWidth: "1d" as const,
      schedule: "0 * * * *",
      startingAt,
    };
  }

  /** Runs once from nothing, so the cursor it returns carries this config's identity. */
  async function drainedCursor({
    puller,
    config,
    bucketStart,
  }: {
    puller: AnthropicAdminPullerAdapter;
    config: ReturnType<typeof costConfig>;
    bucketStart: string;
  }) {
    fetchMock.mockResolvedValue(jsonResponse(costPageStartingAt(bucketStart)));
    const run = await puller.runOnce(RUN_OPTIONS, config);
    fetchMock.mockClear();
    return run.cursor;
  }

  function requestedStart(callIndex = 0): string | null {
    return new URL(
      String(fetchMock.mock.calls[callIndex]?.[0]),
    ).searchParams.get("starting_at");
  }

  describe("when the next cost read starts", () => {
    /** @scenario "A cost read looks back a few days so a late correction is picked up" */
    it("starts a few days behind the day it had reached, but never before the configured start", async () => {
      const puller = new AnthropicAdminPullerAdapter();
      const config = costConfig("2026-07-01T00:00:00.000Z");
      const cursor = await drainedCursor({
        puller,
        config,
        bucketStart: "2026-08-01T00:00:00Z",
      });

      fetchMock.mockResolvedValue(
        jsonResponse(costPageStartingAt("2026-07-29T00:00:00Z")),
      );
      await puller.runOnce({ ...RUN_OPTIONS, cursor }, config);

      // Three days, the same margin the sibling connection already pays for
      // on one request per run.
      expect(requestedStart()).toBe("2026-07-29T00:00:00.000Z");
    });

    /** @scenario "A cost read looks back a few days so a late correction is picked up" */
    it("stops the look-back at the day the connection was told to begin at", async () => {
      const puller = new AnthropicAdminPullerAdapter();
      // A start only one day behind the day reached, so the look-back would
      // otherwise reach before the connection existed.
      const config = costConfig("2026-07-31T00:00:00.000Z");
      const cursor = await drainedCursor({
        puller,
        config,
        bucketStart: "2026-08-01T00:00:00Z",
      });

      fetchMock.mockResolvedValue(
        jsonResponse(costPageStartingAt("2026-07-31T00:00:00Z")),
      );
      await puller.runOnce({ ...RUN_OPTIONS, cursor }, config);

      expect(requestedStart()).toBe("2026-07-31T00:00:00.000Z");
    });
  });

  describe("when a read that looked back finishes", () => {
    /** @scenario "Looking back does not move the saved position backwards" */
    it("saves a position no earlier than the one it started from, and looks back from that same day next time", async () => {
      const puller = new AnthropicAdminPullerAdapter();
      const config = costConfig("2026-07-01T00:00:00.000Z");
      const cursor = await drainedCursor({
        puller,
        config,
        bucketStart: "2026-08-01T00:00:00Z",
      });

      // The looked-back read answers with nothing newer than the day it
      // looked back to — an empty window, a credit, or a workspace somebody
      // deleted all look exactly like this.
      fetchMock.mockResolvedValue(
        jsonResponse(costPageStartingAt("2026-07-29T00:00:00Z")),
      );
      const lookedBack = await puller.runOnce(
        { ...RUN_OPTIONS, cursor },
        config,
      );
      fetchMock.mockClear();

      // The saved position stays at the day already reached. Saving the
      // looked-back day instead walks the source backwards on every run
      // until it reaches the day it was first connected.
      expect(
        (JSON.parse(lookedBack.cursor ?? "{}") as { startingAt?: string })
          .startingAt,
      ).toBe("2026-08-01T00:00:00Z");

      fetchMock.mockResolvedValue(
        jsonResponse(costPageStartingAt("2026-07-29T00:00:00Z")),
      );
      await puller.runOnce(
        { ...RUN_OPTIONS, cursor: lookedBack.cursor },
        config,
      );

      // And the run after it looks back from the day reached, not from the
      // day it looked back to.
      expect(requestedStart()).toBe("2026-07-29T00:00:00.000Z");
    });
  });
});

describe("given an Anthropic source reading token usage rather than money", () => {
  describe("when the next read starts", () => {
    /**
     * The arm from the far side of the look-back: usage rows are identified
     * partly by how the customer asked for them to be bucketed, so re-reading
     * a period after that choice changed lands the same usage beside itself
     * rather than replacing it. Money rows carry no such choice.
     */
    /** @scenario "The token usage read is not rewound" */
    it("starts exactly where the last one finished", async () => {
      const puller = new AnthropicAdminPullerAdapter();
      const config = {
        adapter: "anthropic_admin" as const,
        report: "usage" as const,
        bucketWidth: "1d" as const,
        schedule: "0 * * * *",
        startingAt: "2026-07-01T00:00:00.000Z",
      };

      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));
      const drained = await puller.runOnce(RUN_OPTIONS, config);
      fetchMock.mockClear();
      fetchMock.mockResolvedValue(jsonResponse(USAGE_PAGE));

      await puller.runOnce({ ...RUN_OPTIONS, cursor: drained.cursor }, config);

      expect(
        new URL(String(fetchMock.mock.calls[0]?.[0])).searchParams.get(
          "starting_at",
        ),
      ).toBe("2026-08-01T00:00:00Z");
    });
  });
});
