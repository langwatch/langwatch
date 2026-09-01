// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The seat licence read living inside the Dataverse source, and what the three
 * reads owe each other.
 *
 * Two rules are being held down here at once. The licence read degrades like
 * the cost read — never throwing, never counting an error — because a run that
 * reports errors without moving its cursor is DISCARDED by the worker, the
 * conversations included. And the three reads no longer hold each other
 * hostage: a customer whose environment address is wrong is still being
 * billed, so the reads that can succeed must land while the one that cannot
 * keeps failing.
 *
 * Spec: specs/governance/pulled-seats.feature
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectRefusedError } from "~/utils/ssrfProtection";

import capturedCostReply from "./fixtures/azureCostManagementDailyResponse.json";

interface FetchCall {
  url: string;
  init: (RequestInit & { followRedirects?: boolean }) | undefined;
}

const ENVIRONMENT_URL = "https://org12345.crm.dynamics.com";
const SUBSCRIPTION_ID = "00000000-0000-0000-0000-000000000000";
const CREDENTIALS = {
  tenantId: "3807ec24-0000-4000-8000-000000000001",
  clientId: "app-client-id",
  clientSecret: "app-client-secret",
};
const BOT_ID = "cc7bc3b3-dfd8-4bd9-b637-eac033f399e2";
const TRANSCRIPT_ID = "11111111-1111-4111-8111-111111111111";

const GRAPH_HOST = "graph.microsoft.com";
const COST_HOST = "management.azure.com";
const SEAT_SKU_ID = "d17b27af-3f49-4822-99f9-56a661538792";
const FREE_SKU_ID = "f30db892-07e9-47e9-837c-80727f46fd3d";

/** The transcript position every "it kept its place" assertion is written on. */
const TRANSCRIPT_POSITION = {
  createdon: "2026-08-20T10:00:00.000Z",
  conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
};

const today = () => new Date().toISOString().slice(0, 10);

let capturedCalls: FetchCall[] = [];
let warnings: string[] = [];
/** What Graph answers the licence read with, per call. */
let graphReplies: Array<{ status: number; body: unknown }> = [];
/**
 * Whether the environment will sign this run in. The token endpoint answers
 * per audience, which is the only way to break the conversation half while
 * leaving the two money reads working.
 */
let environmentSignInStatus = 200;
/** What the transcript read answers with. */
let transcriptStatus = 200;
/**
 * Rows the transcript read hands back. Overridden to an empty page so a run
 * can make no conversation progress WITHOUT failing — the only way to watch
 * the licence half decide the cursor on its own.
 */
let transcriptRows: Array<Record<string, unknown>> | null = null;

function captured(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
}

/** The reply Microsoft sends, in its own field casing. */
function subscribedSkusReply() {
  return {
    value: [
      {
        skuId: SEAT_SKU_ID,
        skuPartNumber: "POWER_VIRTUAL_AGENTS_VIRAL",
        appliesTo: "User",
        capabilityStatus: "Enabled",
        consumedUnits: 8,
        prepaidUnits: { enabled: 10, suspended: 0, warning: 0 },
      },
      {
        skuId: FREE_SKU_ID,
        skuPartNumber: "FLOW_FREE",
        appliesTo: "User",
        capabilityStatus: "Enabled",
        consumedUnits: 3,
        prepaidUnits: { enabled: 10000, suspended: 0, warning: 0 },
      },
    ],
  };
}

function transcriptRow() {
  return {
    conversationtranscriptid: TRANSCRIPT_ID,
    name: "b957a08c-0000-4000-8000-000000000001_dacfd251-bot",
    conversationstarttime: "2026-08-25T19:14:34Z",
    createdon: "2026-08-25T19:44:43Z",
    metadata: JSON.stringify({ BotId: "dacfd251-bot", BatchId: 0 }),
    content: JSON.stringify({ activities: [] }),
    _bot_conversationtranscriptid_value: BOT_ID,
  };
}

/** Which audience a sign-in was for, read off the form body it posted. */
function signInIsForEnvironment(body: string): boolean {
  return body.includes(encodeURIComponent(`${ENVIRONMENT_URL}/.default`));
}

beforeEach(() => {
  capturedCalls = [];
  warnings = [];
  graphReplies = [];
  environmentSignInStatus = 200;
  transcriptStatus = 200;
  transcriptRows = null;

  vi.doMock("@langwatch/observability", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createLogger: () => ({
      warn: (...args: unknown[]) => warnings.push(captured(args)),
      error: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    }),
  }));

  vi.doMock("~/utils/ssrfProtection", () => ({
    RedirectRefusedError,
    ssrfSafeFetch: async (url: string, init?: RequestInit) => {
      capturedCalls.push({ url, init });

      if (url.includes("login.microsoftonline.com")) {
        // Only the environment's own audience is refused. Azure Resource
        // Manager and Graph still sign in, which is what leaves the two money
        // reads working while the conversation half cannot start.
        const refused =
          environmentSignInStatus !== 200 &&
          signInIsForEnvironment(String(init?.body));
        return new Response(
          JSON.stringify(refused ? {} : { access_token: "a-token" }),
          {
            status: refused ? environmentSignInStatus : 200,
            headers: { "content-type": "application/json" },
          },
        );
      }
      if (url.includes(GRAPH_HOST)) {
        const next = graphReplies.shift() ?? {
          status: 200,
          body: subscribedSkusReply(),
        };
        return new Response(JSON.stringify(next.body), {
          status: next.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes(COST_HOST)) {
        return new Response(JSON.stringify(capturedCostReply), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/bots")) {
        return new Response(
          JSON.stringify({ value: [{ botid: BOT_ID, name: "eng-agent" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify(
          transcriptStatus === 200
            ? { value: transcriptRows ?? [transcriptRow()] }
            : {},
        ),
        {
          status: transcriptStatus,
          headers: { "content-type": "application/json" },
        },
      );
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function runPull({
  readSeats = true,
  azureSubscriptionId,
  cursor = null,
}: {
  readSeats?: boolean;
  azureSubscriptionId?: string;
  cursor?: string | null;
}) {
  const { CopilotStudioDataversePuller } = await import(
    "../copilotStudioDataverse.puller"
  );
  const adapter = new CopilotStudioDataversePuller();
  return adapter.runOnce(
    { cursor, credentials: CREDENTIALS },
    {
      adapter: "copilot_studio_dataverse" as const,
      environmentUrl: ENVIRONMENT_URL,
      botIds: [],
      readSeats,
      ...(azureSubscriptionId === undefined ? {} : { azureSubscriptionId }),
    },
  );
}

const graphCalls = () =>
  capturedCalls.filter((call) => call.url.includes(GRAPH_HOST));
const seatEvents = <T extends { action: string }>(events: T[]) =>
  events.filter((event) => event.action === "seat_report");
const costEvents = <T extends { action: string }>(events: T[]) =>
  events.filter((event) => event.action === "cost_report");
const conversationEvents = <T extends { action: string }>(events: T[]) =>
  events.filter(
    (event) => event.action !== "seat_report" && event.action !== "cost_report",
  );

describe("the seat licence read inside the Dataverse source", () => {
  describe("when an admin has switched the licence reading off", () => {
    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("asks Microsoft Graph nothing and still delivers the conversations", async () => {
      const result = await runPull({ readSeats: false });

      expect(graphCalls()).toHaveLength(0);
      expect(seatEvents(result.events)).toHaveLength(0);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });

    /** @scenario "A source whose licence reading is switched off reads none at all" */
    it("signs in for no audience it does not need", async () => {
      await runPull({ readSeats: false });

      const scopes = capturedCalls
        .filter((call) => call.url.includes("login.microsoftonline.com"))
        .map((call) => String(call.init?.body));
      expect(
        scopes.some((body) =>
          body.includes(encodeURIComponent("https://graph.microsoft.com")),
        ),
      ).toBe(false);
    });
  });

  describe("when the source reads licences", () => {
    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("records a pool per licence beside the conversations", async () => {
      const result = await runPull({});

      expect(seatEvents(result.events)).toHaveLength(2);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("asks Graph once, with the token it must not hand onward", async () => {
      await runPull({});
      const [call] = graphCalls();

      expect(graphCalls()).toHaveLength(1);
      expect(call?.url).toBe("https://graph.microsoft.com/v1.0/subscribedSkus");
      expect(call?.init?.method).toBe("GET");
      expect(call?.init?.followRedirects).toBe(false);
    });

    /** @scenario "Each licence pool is recorded with bought and assigned counts" */
    it("signs in for Microsoft Graph, not for the environment", async () => {
      await runPull({});

      const scopes = capturedCalls
        .filter((call) => call.url.includes("login.microsoftonline.com"))
        .map((call) => String(call.init?.body));
      expect(
        scopes.some((body) =>
          body.includes(
            encodeURIComponent("https://graph.microsoft.com/.default"),
          ),
        ),
      ).toBe(true);
      // The environment token is still minted for the transcript read: the two
      // are different audiences and one cannot stand in for the other.
      expect(scopes.some(signInIsForEnvironment)).toBe(true);
    });

    /** @scenario "A day already reported is not asked about again" */
    it("records how far licences are reported on the cursor it hands back", async () => {
      const result = await runPull({});
      const cursor = JSON.parse(String(result.cursor));

      expect(cursor.seatsReportedThroughDay).toBe(today());
      // Written as an explicit null, not merely absent: a build that stopped
      // writing the field would read identical under `?? null`.
      expect(cursor).toHaveProperty("seatsHeldSinceMs", null);
      expect(cursor.conversationtranscriptid).toBe(TRANSCRIPT_ID);
    });
  });

  describe("when the day's licences were already reported", () => {
    /** @scenario "A day already reported is not asked about again" */
    it("does not ask Graph again", async () => {
      const result = await runPull({
        cursor: JSON.stringify({
          ...TRANSCRIPT_POSITION,
          seatsReportedThroughDay: today(),
          seatsHeldSinceMs: null,
        }),
      });

      expect(graphCalls()).toHaveLength(0);
      expect(seatEvents(result.events)).toHaveLength(0);
      // The conversations are still read: the licence position holding still
      // must not hold anything else still.
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });
  });

  describe("when Microsoft Graph refuses the licence read", () => {
    /** @scenario "A failed licence read never fails a run that read conversations" */
    it("delivers the conversations and counts no error", async () => {
      graphReplies = [{ status: 403, body: { error: { code: "Forbidden" } } }];

      const result = await runPull({
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });

      // A run that reported an error here would have its events discarded and
      // its cursor left where it was, so an ungranted consent would cost the
      // customer their transcripts.
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      expect(seatEvents(result.events)).toHaveLength(0);
      // The transcript half moved on regardless.
      const cursor = JSON.parse(String(result.cursor));
      expect(cursor.conversationtranscriptid).toBe(TRANSCRIPT_ID);
    });

    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("records no seat count and holds the day", async () => {
      graphReplies = [{ status: 403, body: {} }];

      const result = await runPull({
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });
      const cursor = JSON.parse(String(result.cursor));

      expect(seatEvents(result.events)).toHaveLength(0);
      // Not reported: a zero would be a confident wrong number that a summary
      // would faithfully honour.
      expect(cursor).toHaveProperty("seatsReportedThroughDay", null);
      expect(typeof cursor.seatsHeldSinceMs).toBe("number");
      expect(warnings.join(" ")).toContain("403");
    });

    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("asks again on the next run", async () => {
      graphReplies = [{ status: 403, body: {} }];
      const first = await runPull({
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });

      capturedCalls = [];
      const second = await runPull({ cursor: String(first.cursor) });

      expect(graphCalls()).toHaveLength(1);
      expect(seatEvents(second.events)).toHaveLength(2);
      const cursor = JSON.parse(String(second.cursor));
      expect(cursor.seatsReportedThroughDay).toBe(today());
      expect(cursor).toHaveProperty("seatsHeldSinceMs", null);
    });

    /** @scenario "A failed licence read holds the day rather than recording zero" */
    it("holds the day when Graph answers with a body it cannot read", async () => {
      graphReplies = [{ status: 200, body: { nonsense: true } }];

      const result = await runPull({
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });
      const cursor = JSON.parse(String(result.cursor));

      // An unreadable body taken as an empty list would publish a tenant that
      // holds no licences at all, and mark the day reported.
      expect(seatEvents(result.events)).toHaveLength(0);
      expect(cursor).toHaveProperty("seatsReportedThroughDay", null);
      expect(result.errorCount).toBe(0);
    });
  });

  describe("when every pool in the list is one Graph cannot be read from", () => {
    /** @scenario "A list whose every pool is unreadable holds the day" */
    it("holds the day rather than reporting a tenant that holds nothing", async () => {
      graphReplies = [
        {
          status: 200,
          body: { value: [{ skuPartNumber: "VIRTUAL_AGENT_USL" }, {}] },
        },
      ];

      const result = await runPull({
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });
      const cursor = JSON.parse(String(result.cursor));

      // A list nothing could be read from arrives as the same empty list a
      // tenant that genuinely holds no licences does, and a day marked
      // reported is never asked about again.
      expect(seatEvents(result.events)).toHaveLength(0);
      expect(cursor).toHaveProperty("seatsReportedThroughDay", null);
      expect(typeof cursor.seatsHeldSinceMs).toBe("number");
      expect(result.errorCount).toBe(0);
    });

    /** @scenario "A list whose every pool is unreadable holds the day" */
    it("keeps the pools it could read when only some of them fail", async () => {
      graphReplies = [
        {
          status: 200,
          body: {
            value: [...subscribedSkusReply().value, { skuPartNumber: "BROKEN" }],
          },
        },
      ];

      const result = await runPull({
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });
      const cursor = JSON.parse(String(result.cursor));

      // The hold above is for a list that yielded nothing at all. One bad pool
      // must still not cost the tenant the rest of its list.
      expect(seatEvents(result.events)).toHaveLength(2);
      expect(cursor.seatsReportedThroughDay).toBe(today());
    });
  });

  describe("when a day has been held past the cap", () => {
    /** @scenario "A day held for too long is given up rather than held forever" */
    it("hands back a moved cursor so the giving-up is persisted", async () => {
      // The one shape where the licence half alone decides the cursor, and the
      // one that would pin a source forever if it were missed: an unchanged
      // cursor is the run's "no progress" answer, so a give-up that did not
      // register as movement would never be stored, and the next run would
      // give up again — a Graph call every run, for a consent that will never
      // be granted.
      const previous = JSON.stringify({
        ...TRANSCRIPT_POSITION,
        seatsReportedThroughDay: "2026-07-01",
        seatsHeldSinceMs: 1_000,
      });
      graphReplies = [{ status: 403, body: {} }];
      transcriptRows = [];

      const result = await runPull({ cursor: previous });

      expect(result.errorCount).toBe(0);
      expect(result.cursor).not.toBe(previous);
      const cursor = JSON.parse(String(result.cursor));
      expect(cursor.seatsReportedThroughDay).toBe(today());
      // Still held, which is what marks this as given up rather than read: the
      // pair is what stops tomorrow re-opening a week of every-run requests.
      expect(cursor.seatsHeldSinceMs).toBe(1_000);
    });

    /** @scenario "A day already reported is not asked about again" */
    it("asks Graph once more the next day and no more often", async () => {
      const previous = JSON.stringify({
        ...TRANSCRIPT_POSITION,
        seatsReportedThroughDay: "2026-07-01",
        seatsHeldSinceMs: 1_000,
      });
      graphReplies = [{ status: 403, body: {} }];
      transcriptRows = [];
      const first = await runPull({ cursor: previous });

      capturedCalls = [];
      graphReplies = [{ status: 403, body: {} }];
      const second = await runPull({ cursor: String(first.cursor) });

      // The give-up put the mark on today, so the retry waits for the day roll
      // rather than happening on the very next run.
      expect(graphCalls()).toHaveLength(0);
      expect(second.cursor).toBe(String(first.cursor));
      expect(second.errorCount).toBe(0);
    });
  });

  describe("when a re-read covers a day already recorded", () => {
    /** @scenario "Both reads of a re-read day describe the same pool under the same identity" */
    it("names the same pool the same way both times", async () => {
      const first = await runPull({});
      // The run's position was thrown away, so the next run asks again.
      const second = await runPull({});

      const ids = (events: Array<{ source_event_id: string }>) =>
        events.map((event) => event.source_event_id).sort();
      expect(ids(seatEvents(first.events))).toEqual(
        ids(seatEvents(second.events)),
      );
      // Named for the pool and the day the run reported on. A day the puller
      // failed to work out would still compare equal above, and would land
      // every re-read under one identity for all time.
      expect(ids(seatEvents(first.events))).toContain(
        `msgraph_seats:${SEAT_SKU_ID}:${today()}`,
      );
    });
  });

  describe("when the stored position predates the licence read", () => {
    /** @scenario "A source position written before seats existed still reads" */
    it("parses it and reads licences as never yet reported", async () => {
      const oldCursor = JSON.stringify(TRANSCRIPT_POSITION);

      const result = await runPull({ cursor: oldCursor });

      // It resumed the transcript walk from the old position rather than
      // treating the cursor as unreadable and re-reading the whole window.
      const transcriptCall = capturedCalls.find((call) =>
        call.url.includes("/conversationtranscripts"),
      );
      expect(decodeURIComponent(transcriptCall?.url ?? "")).toContain(
        TRANSCRIPT_POSITION.createdon,
      );
      expect(graphCalls()).toHaveLength(1);
      expect(seatEvents(result.events)).toHaveLength(2);
      expect(result.errorCount).toBe(0);
    });
  });

  describe("when the environment cannot be signed in to", () => {
    /** @scenario "The bill is still recorded when the environment cannot be reached" */
    it("still delivers the bill and the licences, and still reports the failure", async () => {
      environmentSignInStatus = 500;

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });

      expect(costEvents(result.events).length).toBeGreaterThan(0);
      expect(seatEvents(result.events)).toHaveLength(2);
      expect(conversationEvents(result.events)).toHaveLength(0);
      expect(result.errorCount).toBeGreaterThan(0);

      const cursor = JSON.parse(String(result.cursor));
      expect(cursor.costPricedThroughDay).toBe(today());
      expect(cursor.seatsReportedThroughDay).toBe(today());
      // The conversation position is exactly where it was, or the next run
      // would skip the conversations this one never read.
      expect(cursor.conversationtranscriptid).toBe(
        TRANSCRIPT_POSITION.conversationtranscriptid,
      );
      expect(cursor.createdon).toBe(TRANSCRIPT_POSITION.createdon);
    });

    /** @scenario "A conversation failure with no new bill still fails the run" */
    it("fails the run once both marks are already on today", async () => {
      // The cost and seat marks only move on the day roll. If their daily
      // advance stood in for conversation progress on every run, a dead
      // environment would look like steady progress.
      const previous = JSON.stringify({
        ...TRANSCRIPT_POSITION,
        costPricedThroughDay: today(),
        costHeldSinceMs: null,
        seatsReportedThroughDay: today(),
        seatsHeldSinceMs: null,
      });
      environmentSignInStatus = 500;

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: previous,
      });

      expect(result.errorCount).toBeGreaterThan(0);
      // The INCOMING string verbatim, which is what the worker compares.
      expect(result.cursor).toBe(previous);
    });

    /** @scenario "The conversation window is retried without losing the priced bill" */
    it("resumes the conversation window and does not re-read licences the same day", async () => {
      environmentSignInStatus = 500;
      const failed = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: JSON.stringify(TRANSCRIPT_POSITION),
      });

      capturedCalls = [];
      environmentSignInStatus = 200;
      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: String(failed.cursor),
      });

      const transcriptCall = capturedCalls.find((call) =>
        call.url.includes("/conversationtranscripts"),
      );
      expect(decodeURIComponent(transcriptCall?.url ?? "")).toContain(
        TRANSCRIPT_POSITION.createdon,
      );
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      // The licence day was kept by the failed run, so this one does not spend
      // a request re-learning it.
      expect(graphCalls()).toHaveLength(0);
      const cursor = JSON.parse(String(result.cursor));
      expect(cursor.seatsReportedThroughDay).toBe(today());
    });
  });
});
