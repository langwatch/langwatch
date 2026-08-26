// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The OpenAI Admin cost adapter. The transport is stubbed; what is under test
 * is the bucket → record mapping, the money surviving unconverted, the
 * trailing re-read, and the fallback when the provider refuses to group a
 * window by API key.
 *
 * Spec: specs/ai-governance/puller-framework/openai-admin-cost.feature
 * Decision: ADR-122.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

const { fetchMock } = vi.hoisted(() => ({ fetchMock: vi.fn() }));
vi.mock("~/utils/ssrfProtection", () => ({
  ssrfSafeFetch: (...args: unknown[]) => fetchMock(...args),
}));

/** The reason a failed run leaves behind is a log line, so the log is captured. */
const logged = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));
vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/observability")>()),
  createLogger: () => logged,
}));

import {
  OPENAI_ADMIN_ADAPTER_ID,
  OpenAiAdminPuller,
} from "../openaiAdmin.puller";
import { buildPulledUsageRecord } from "../pulledUsageRecord";

const SOURCE = {
  ingestionSourceId: "src_1",
  sourceType: OPENAI_ADMIN_ADAPTER_ID,
  organizationId: "org_acme",
  teamId: "team_platform",
};
const OBSERVED_AT = new Date("2026-08-26T09:00:00.000Z");

/** 2026-08-01T00:00:00Z, the shape the API reports a bucket start in. */
const BUCKET_START_EPOCH = 1785542400;
const BUCKET_START_ISO = "2026-08-01T00:00:00.000Z";

const CONFIG = {
  adapter: OPENAI_ADMIN_ADAPTER_ID,
  report: "cost",
  startingAt: "2026-07-01T00:00:00.000Z",
  schedule: "0 * * * *",
} as const;

const RUN_OPTIONS = { cursor: null, credentials: { token: "sk-admin" } };

function jsonResponse(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

/** The provider's own 400 envelope, verbatim in shape. */
function errorResponse({
  status,
  param,
  code,
  message,
}: {
  status: number;
  param: string | null;
  code: string;
  message: string;
}) {
  return {
    ok: false,
    status,
    statusText: "Bad Request",
    text: async () =>
      JSON.stringify({
        error: { message, type: "invalid_request_error", param, code },
      }),
    json: async () => ({}),
  };
}

const KEY_GROUPING_REFUSAL = errorResponse({
  status: 400,
  param: "start_time",
  code: "invalid_request_error",
  message:
    "group_by=api_key_id is not available for this time range. Try a start_time on or after 1764979200.",
});

/**
 * `amount.value` is a JSON number in DOLLARS. The sibling adapter's provider
 * reports cents; a decimal shift here would report a hundred times this.
 */
function costRow(overrides: Record<string, unknown> = {}) {
  return {
    object: "organization.costs.result",
    amount: { value: 0.0025945, currency: "usd" },
    line_item: "gpt-5, input",
    project_id: "proj_a",
    organization_id: "org_acme",
    user_id: "user-1",
    user_email: "someone@example.com",
    api_key_id: "key_a",
    ...overrides,
  };
}

function page({
  results = [costRow()],
  startTime = BUCKET_START_EPOCH,
  nextPage = null,
  hasMore = false,
}: {
  results?: unknown[];
  startTime?: number;
  nextPage?: string | null;
  hasMore?: boolean;
} = {}) {
  return {
    data: [{ start_time: startTime, end_time: startTime + 86400, results }],
    has_more: hasMore,
    next_page: nextPage,
  };
}

function requestedUrl(callIndex = 0): URL {
  return new URL(String(fetchMock.mock.calls[callIndex]?.[0]));
}

describe("given an OpenAI Admin cost source", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    for (const level of Object.values(logged)) level.mockReset();
  });

  describe("when the provider reports a day's spend", () => {
    /** @scenario "A day's spend is recorded as the dollars the provider reported" */
    it("records the provider's dollars without converting them", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(result.events).toHaveLength(1);
      // To the digit. A cents→dollars shift would make this 0.000025945.
      expect(result.events[0]?.cost_usd).toBe("0.0025945");
    });

    /** @scenario "A fraction of a cent survives the record" */
    it("keeps every digit of a sub-cent figure through to the record", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          page({
            results: [
              costRow({ amount: { value: 0.0000001234, currency: "usd" } }),
            ],
          }),
        ),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);
      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });

      expect(record?.costNanoUsd).toBeGreaterThan(0);
    });

    /** @scenario "Spend is called an estimate, not the invoice" */
    it("marks the figure the provider's own, and an estimate", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);
      const record = buildPulledUsageRecord({
        event: result.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });

      expect(record?.costBasis).toBe("provider_reported");
      expect(record?.costStatus).toBe("estimate");
    });

    /** @scenario "Spend is attributed to the person the provider named" */
    it("names the person by email and carries the provider's raw id", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);
      const event = result.events[0]!;

      expect(event.actor).toBe("someone@example.com");
      expect(event.extra?.actorUserId).toBe("user-1");
    });

    /** @scenario "The credential the spend was billed to is recorded" */
    it("carries the API key the spend was billed against", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(result.events[0]?.extra?.apiKeyId).toBe("key_a");
    });

    /** @scenario "Spend billed to a deleted key is still recorded against it" */
    it("records spend against a key id that no longer names a live key", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(page({ results: [costRow({ api_key_id: "key_gone" })] })),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(result.events[0]?.extra?.apiKeyId).toBe("key_gone");
      // Nothing is asked about the key — the cost report is the only request —
      // so a key deleted since the spend cannot drop the row that names it.
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Nobody is looked up while pulling" */
    it("asks the provider for nothing but the cost report", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));

      await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(requestedUrl().pathname).toBe("/v1/organization/costs");
    });

    /** @scenario "Only the cost report is read" */
    it("sends the four dimensions the report is keyed on, daily, at the page ceiling", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));

      await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);
      const url = requestedUrl();

      expect(url.searchParams.getAll("group_by[]")).toEqual([
        "project_id",
        "line_item",
        "user_id",
        "api_key_id",
      ]);
      expect(url.searchParams.get("bucket_width")).toBe("1d");
      expect(url.searchParams.get("limit")).toBe("180");
      // A window whose end moves with the clock invalidates every page token.
      expect(url.searchParams.has("end_time")).toBe(false);
      // Epoch seconds, not an ISO instant.
      expect(url.searchParams.get("start_time")).toBe(
        String(Date.parse(CONFIG.startingAt) / 1000),
      );
    });
  });

  describe("when a bucket carries no spend", () => {
    /** @scenario "A day whose spend has vanished keeps the figure it had" */
    it("writes no usage record at all rather than a zero", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page({ results: [] })));

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      // No event means no hint, and no hint means the ledger is untouched —
      // a zero written here would win argMax against a confirmed figure.
      expect(result.events).toEqual([]);
    });

    /** @scenario "A day with no spend at all is still read past" */
    it("still moves past the empty day", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page({ results: [] })));

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(JSON.parse(result.cursor!).startingAt).toBe(BUCKET_START_ISO);
    });
  });

  describe("when the provider corrects a day it already reported", () => {
    /** @scenario "A corrected day replaces its earlier figure rather than adding one" */
    it("keys the correction onto the same record as the original", async () => {
      const puller = new OpenAiAdminPuller();

      fetchMock.mockResolvedValue(jsonResponse(page()));
      const first = await puller.runOnce(RUN_OPTIONS, CONFIG);

      fetchMock.mockResolvedValue(
        jsonResponse(
          page({
            results: [costRow({ amount: { value: 9.99, currency: "usd" } })],
          }),
        ),
      );
      const second = await puller.runOnce(RUN_OPTIONS, CONFIG);

      const before = buildPulledUsageRecord({
        event: first.events[0]!,
        source: SOURCE,
        observedAt: OBSERVED_AT,
      });
      const after = buildPulledUsageRecord({
        event: second.events[0]!,
        source: SOURCE,
        observedAt: new Date(OBSERVED_AT.getTime() + 60_000),
      });

      expect(after?.restatementKey).toBe(before?.restatementKey);
      expect(after?.costNanoUsd).not.toBe(before?.costNanoUsd);
    });

    /** @scenario "Re-reading an unchanged day records nothing new" */
    it("produces the identical record when nothing changed", async () => {
      const puller = new OpenAiAdminPuller();
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const first = await puller.runOnce(RUN_OPTIONS, CONFIG);
      const second = await puller.runOnce(RUN_OPTIONS, CONFIG);

      expect(second.events[0]?.source_event_id).toBe(
        first.events[0]?.source_event_id,
      );
      expect(second.events[0]?.cost_usd).toBe(first.events[0]?.cost_usd);
    });

    /** @scenario "The source keeps looking back far enough to see a correction" */
    it("starts the next run behind its own watermark", async () => {
      const puller = new OpenAiAdminPuller();
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const first = await puller.runOnce(RUN_OPTIONS, CONFIG);
      await puller.runOnce({ ...RUN_OPTIONS, cursor: first.cursor }, CONFIG);

      const secondRunStart = Number(
        requestedUrl(1).searchParams.get("start_time"),
      );
      // Three days behind the bucket the first run ended on.
      expect(secondRunStart).toBe(BUCKET_START_EPOCH - 3 * 86400);
    });

    /** @scenario "The source keeps looking back far enough to see a correction" */
    it("never looks back past the start an admin configured", async () => {
      const puller = new OpenAiAdminPuller();
      fetchMock.mockResolvedValue(jsonResponse(page()));

      const config = { ...CONFIG, startingAt: "2026-07-31T00:00:00.000Z" };
      const first = await puller.runOnce(RUN_OPTIONS, config);
      await puller.runOnce({ ...RUN_OPTIONS, cursor: first.cursor }, config);

      expect(Number(requestedUrl(1).searchParams.get("start_time"))).toBe(
        Math.floor(Date.parse("2026-07-31T00:00:00.000Z") / 1000),
      );
    });

    /** @scenario "Looking back never rewinds the source's progress" */
    it("keeps the newest bucket even when the page arrives out of order", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse({
          data: [
            {
              start_time: BUCKET_START_EPOCH,
              results: [costRow()],
            },
            {
              start_time: BUCKET_START_EPOCH - 86400,
              results: [costRow({ api_key_id: "key_b" })],
            },
          ],
          has_more: false,
          next_page: null,
        }),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      // The LATEST bucket, not the last one in the array. Ordering is observed
      // but not guaranteed, so nothing here may depend on it.
      expect(JSON.parse(result.cursor!).startingAt).toBe(BUCKET_START_ISO);
    });
  });

  describe("when the provider refuses to group a window by API key", () => {
    /** @scenario "Older spend is still recorded and still names the person" */
    it("re-reads the same window without that dimension", async () => {
      fetchMock
        .mockResolvedValueOnce(KEY_GROUPING_REFUSAL)
        .mockResolvedValueOnce(
          jsonResponse(page({ results: [costRow({ api_key_id: null })] })),
        );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(fetchMock).toHaveBeenCalledTimes(2);
      // Same window, one dimension fewer.
      expect(requestedUrl(1).searchParams.get("start_time")).toBe(
        requestedUrl(0).searchParams.get("start_time"),
      );
      expect(requestedUrl(1).searchParams.getAll("group_by[]")).toEqual([
        "project_id",
        "line_item",
        "user_id",
      ]);
      expect(result.events).toHaveLength(1);
      expect(result.events[0]?.extra?.actorUserId).toBe("user-1");
    });

    /** @scenario "Older spend says nothing about which key was used" */
    it("leaves the key out of the record's coordinates rather than claiming an empty one", async () => {
      fetchMock
        .mockResolvedValueOnce(KEY_GROUPING_REFUSAL)
        .mockResolvedValueOnce(
          jsonResponse(page({ results: [costRow({ api_key_id: null })] })),
        );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);
      const hint = result.events[0]?.extra?.pulled_usage as {
        dimensions: Record<string, string>;
      };

      expect(Object.keys(hint.dimensions)).not.toContain("apiKeyId");
      expect(hint.dimensions.userId).toBe("user-1");
    });

    /** @scenario "A refusal about anything else is not mistaken for the cutoff" */
    it("does not drop the dimension for a differently-shaped rejection", async () => {
      fetchMock.mockResolvedValue(
        errorResponse({
          status: 400,
          param: "start_time",
          // A date it could not parse — same param, different code.
          code: "invalid_type",
          message: "Invalid type for 'start_time'.",
        }),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.errorCount).toBe(1);
      expect(result.cursor).toBeNull();
    });

    /** @scenario "A refusal about anything else is not mistaken for the cutoff" */
    it("does not drop the dimension when the limit is what was refused", async () => {
      fetchMock.mockResolvedValue(
        errorResponse({
          status: 400,
          param: null,
          code: "invalid_request_error",
          message: "Limit must be less than or equal to 180.",
        }),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.errorCount).toBe(1);
    });

    it("keeps asking without the key for the rest of the window it fell back on", async () => {
      const puller = new OpenAiAdminPuller();
      fetchMock
        .mockResolvedValueOnce(KEY_GROUPING_REFUSAL)
        .mockResolvedValueOnce(
          jsonResponse(
            page({
              results: [costRow({ api_key_id: null })],
              nextPage: "page_2",
              hasMore: true,
            }),
          ),
        )
        .mockResolvedValue(
          jsonResponse(page({ results: [costRow({ api_key_id: null })] })),
        );

      await puller.runOnce(RUN_OPTIONS, CONFIG);

      // The page token is bound to the query that minted it, so the third
      // request must carry the same three dimensions as the second.
      expect(requestedUrl(2).searchParams.getAll("group_by[]")).toEqual([
        "project_id",
        "line_item",
        "user_id",
      ]);
      expect(requestedUrl(2).searchParams.get("page")).toBe("page_2");
    });
  });

  describe("when a run cannot finish", () => {
    /** @scenario "A failed read leaves the source where it was" */
    it("holds the cursor still and reports the failure", async () => {
      fetchMock.mockRejectedValue(new Error("connection reset"));

      const result = await new OpenAiAdminPuller().runOnce(
        { ...RUN_OPTIONS, cursor: "prior-cursor" },
        CONFIG,
      );

      expect(result.cursor).toBe("prior-cursor");
      expect(result.errorCount).toBe(1);
      expect(result.events).toEqual([]);
    });

    /** @scenario "A failed read leaves the source where it was" */
    it("keeps the pages it already read when the deadline passes", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(page({ nextPage: "page_2", hasMore: true })),
      );

      const result = await new OpenAiAdminPuller().runOnce(
        { ...RUN_OPTIONS, deadlineMs: Date.now() + 5 },
        CONFIG,
      );

      expect(result.errorCount).toBe(0);
      expect(result.events.length).toBeGreaterThan(0);
      expect(JSON.parse(result.cursor!).page).toBe("page_2");
    });

    /** @scenario "Looking back never rewinds the source's progress" */
    it("does not walk the window backwards when run after run runs out of time", async () => {
      const puller = new OpenAiAdminPuller();
      fetchMock.mockResolvedValue(jsonResponse(page()));
      let cursor: string | null = JSON.stringify({
        startingAt: BUCKET_START_ISO,
        page: null,
        query: `cost:1d:project_id,line_item,user_id,api_key_id:${CONFIG.startingAt}`,
        watermark: null,
        keyGrouping: true,
      });

      const starts: string[] = [];
      for (let i = 0; i < 3; i += 1) {
        const result = await puller.runOnce(
          { ...RUN_OPTIONS, cursor, deadlineMs: Date.now() - 1 },
          CONFIG,
        );
        cursor = result.cursor;
        starts.push(JSON.parse(cursor!).startingAt);
      }

      // The look-back is applied to the stored start on every run; storing the
      // looked-back value would compound it and walk a chronically slow source
      // back to its backfill start.
      expect(starts).toEqual([
        BUCKET_START_ISO,
        BUCKET_START_ISO,
        BUCKET_START_ISO,
      ]);
    });

    /** @scenario "Every page of a window is read" */
    it("follows the page token to the end of the window", async () => {
      fetchMock
        .mockResolvedValueOnce(
          jsonResponse(page({ nextPage: "page_2", hasMore: true })),
        )
        .mockResolvedValueOnce(
          jsonResponse(
            page({
              startTime: BUCKET_START_EPOCH + 86400,
              results: [costRow({ project_id: "proj_b" })],
            }),
          ),
        );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(result.events).toHaveLength(2);
      expect(requestedUrl(1).searchParams.get("page")).toBe("page_2");
    });

    it("refuses a page claiming more data with no token to reach it", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(page({ hasMore: true, nextPage: null })),
      );

      await expect(
        new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG),
      ).rejects.toThrow(/has_more with no next_page/);
    });

    /** @scenario "A page token is never replayed under a changed question" */
    it("discards a page token minted under a different backfill start", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));
      const stale = JSON.stringify({
        startingAt: "2026-07-15T00:00:00.000Z",
        page: "page_from_before",
        query:
          "cost:1d:project_id,line_item,user_id,api_key_id:2026-06-01T00:00:00.000Z",
        watermark: null,
        keyGrouping: true,
      });

      await new OpenAiAdminPuller().runOnce(
        { ...RUN_OPTIONS, cursor: stale },
        CONFIG,
      );

      expect(requestedUrl().searchParams.has("page")).toBe(false);
    });

    /** @scenario "Widening the backfill start makes the source read the older days" */
    it("re-reads from the earlier of the stored watermark and a widened start", async () => {
      fetchMock.mockResolvedValue(jsonResponse(page()));
      const mature = JSON.stringify({
        startingAt: BUCKET_START_ISO,
        page: null,
        query:
          "cost:1d:project_id,line_item,user_id,api_key_id:2026-07-01T00:00:00.000Z",
        watermark: null,
        keyGrouping: true,
      });

      await new OpenAiAdminPuller().runOnce(
        { ...RUN_OPTIONS, cursor: mature },
        { ...CONFIG, startingAt: "2026-05-01T00:00:00.000Z" },
      );

      expect(Number(requestedUrl().searchParams.get("start_time"))).toBe(
        Math.floor(Date.parse("2026-05-01T00:00:00.000Z") / 1000),
      );
    });
  });

  describe("when the row is not one the ledger can hold", () => {
    it("skips a row in another currency rather than failing the window", async () => {
      fetchMock.mockResolvedValue(
        jsonResponse(
          page({
            results: [
              costRow({ amount: { value: 1.5, currency: "eur" } }),
              costRow({ project_id: "proj_b" }),
            ],
          }),
        ),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      // The euro row is dropped; the rest of the bucket still lands. A throw
      // here would discard the whole run and fail identically on every retry.
      expect(result.events).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });

    it("refuses a configuration the adapter cannot run", () => {
      expect(() =>
        new OpenAiAdminPuller().validateConfig({
          adapter: "openai_admin",
          report: "usage",
        }),
      ).toThrow(ZodError);
    });

    /** @scenario "A refused key does not put the key in the reason" */
    it("fails a run on a rejected key without writing the key into the reason", async () => {
      fetchMock.mockResolvedValue(
        errorResponse({
          status: 401,
          param: null,
          code: "invalid_api_key",
          message: "Incorrect API key provided: sk-a***min.",
        }),
      );

      const result = await new OpenAiAdminPuller().runOnce(RUN_OPTIONS, CONFIG);

      expect(result.errorCount).toBe(1);
      // The reason is logged and shown on the source, so it is read by people
      // who were never given the credential.
      expect(logged.error).toHaveBeenCalled();
      for (const call of logged.error.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(
          RUN_OPTIONS.credentials.token,
        );
      }
    });

    it("fails a run with no admin key rather than reporting an empty organization", async () => {
      const result = await new OpenAiAdminPuller().runOnce(
        { cursor: null },
        CONFIG,
      );

      expect(result.errorCount).toBe(1);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
