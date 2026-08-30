// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Azure cost read living inside the Dataverse source.
 *
 * The sharpest rule here is not about money at all. The worker discards a run
 * that reports errors without moving its cursor — INCLUDING the transcripts it
 * already read — so a cost read that threw, or that counted an error, would
 * throw away the conversations the source exists to collect. Every failure
 * mode below therefore degrades to "no cost this run" and nothing else.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 * Decision: ADR-128 §3.
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

let capturedCalls: FetchCall[] = [];
let warnings: string[] = [];
let errors: string[] = [];
/** What the cost endpoint answers with, per call. */
let costReplies: Array<{ status: number; body: unknown }> = [];
/** What the transcript read answers with, so a run can fail after the cost read. */
let transcriptStatus = 200;
/**
 * Rows the transcript read hands back. Overridden to serve a row that parses
 * as neither an event nor a position — the one way a run reports an error
 * WITHOUT throwing, which is the case the cursor comparison turns on.
 */
let transcriptRows: Array<Record<string, unknown>> | null = null;

function captured(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
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

const COST_HOST = "management.azure.com";

beforeEach(() => {
  capturedCalls = [];
  warnings = [];
  errors = [];
  costReplies = [];
  transcriptStatus = 200;
  transcriptRows = null;

  vi.doMock("@langwatch/observability", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createLogger: () => ({
      warn: (...args: unknown[]) => warnings.push(captured(args)),
      error: (...args: unknown[]) => errors.push(captured(args)),
      info: () => undefined,
      debug: () => undefined,
    }),
  }));

  vi.doMock("~/utils/ssrfProtection", () => ({
    RedirectRefusedError,
    ssrfSafeFetch: async (url: string, init?: RequestInit) => {
      capturedCalls.push({ url, init });

      if (url.includes(COST_HOST)) {
        const next = costReplies.shift() ?? {
          status: 200,
          body: capturedCostReply,
        };
        return new Response(JSON.stringify(next.body), {
          status: next.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("login.microsoftonline.com")) {
        return new Response(JSON.stringify({ access_token: "a-token" }), {
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
      // The transcript read: one row, no next page.
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
  azureSubscriptionId,
  cursor = null,
}: {
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
      ...(azureSubscriptionId === undefined ? {} : { azureSubscriptionId }),
    },
  );
}

const costCalls = () => capturedCalls.filter((c) => c.url.includes(COST_HOST));
const costEvents = (events: Array<{ action: string }>) =>
  events.filter((event) => event.action === "cost_report");
const conversationEvents = (events: Array<{ action: string }>) =>
  events.filter((event) => event.action !== "cost_report");

describe("the Azure cost read inside the Dataverse source", () => {
  describe("when the source names no Azure subscription", () => {
    /** @scenario "A source that names no subscription reads no cost at all" */
    it("makes no cost request and still delivers the conversations", async () => {
      const result = await runPull({});

      expect(costCalls()).toHaveLength(0);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });
  });

  describe("when the source names a subscription", () => {
    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("records a day per meter category alongside the conversations", async () => {
      const result = await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });

      expect(costEvents(result.events)).toHaveLength(44);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("asks the Cost Management endpoint for that subscription", async () => {
      await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });
      const [call] = costCalls();

      expect(call?.url).toContain(`/subscriptions/${SUBSCRIPTION_ID}/`);
      expect(call?.url).toContain("Microsoft.CostManagement/query");
      expect(call?.init?.method).toBe("POST");
      // The request carries a token, so a redirect must not carry it onward.
      expect(call?.init?.followRedirects).toBe(false);
    });

    /** @scenario "The daily bill is read as the currency the customer is billed in" */
    it("signs in for Azure Resource Manager, not for the environment", async () => {
      await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });
      const tokenCalls = capturedCalls.filter((c) =>
        c.url.includes("login.microsoftonline.com"),
      );

      const scopes = tokenCalls.map((call) => String(call.init?.body));
      expect(
        scopes.some((body) =>
          body.includes(
            encodeURIComponent("https://management.azure.com/.default"),
          ),
        ),
      ).toBe(true);
      // The environment token is still minted for the transcript read: the two
      // are different audiences and one cannot stand in for the other.
      expect(
        scopes.some((body) =>
          body.includes(encodeURIComponent(ENVIRONMENT_URL)),
        ),
      ).toBe(true);
    });

    /** @scenario "A day already recorded is re-read and its figure replaced, not added to" */
    it("records how far cost is priced on the cursor it hands back", async () => {
      const result = await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });
      const cursor = JSON.parse(String(result.cursor));

      expect(cursor.costPricedThroughDay).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // Written as an explicit null, not merely absent: a build that stopped
      // writing the field would read identical under `?? null`.
      expect(cursor).toHaveProperty("costHeldSinceMs", null);
      // The transcript position is still there and unchanged in shape.
      expect(cursor.conversationtranscriptid).toBe(TRANSCRIPT_ID);
    });
  });

  describe("when Microsoft asks the cost read to retry later", () => {
    /** @scenario "Being asked to slow down leaves the window unpriced rather than priced at nothing" */
    it("records no cost, no error, and holds the window", async () => {
      costReplies = [
        { status: 429, body: { error: "Too many requests. Please retry." } },
      ];

      const result = await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });
      const cursor = JSON.parse(String(result.cursor));

      expect(costEvents(result.events)).toHaveLength(0);
      expect(result.errorCount).toBe(0);
      expect(cursor).toHaveProperty("costPricedThroughDay", null);
      expect(typeof cursor.costHeldSinceMs).toBe("number");
    });

    /** @scenario "The very first cost read ever being throttled leaves nothing behind" */
    it("still delivers the conversations, which is the point of the run", async () => {
      costReplies = [{ status: 429, body: {} }];

      const result = await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });

      // A run that reported an error here would have its events discarded and
      // its cursor left where it was, so a throttled bill would cost the
      // customer their transcripts.
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      expect(warnings.join(" ")).toContain("429");
    });

    /** @scenario "A held window is asked about again on the next run" */
    it("does not wait in place for the throttle to pass", async () => {
      costReplies = [{ status: 429, body: {} }];
      const startedAt = Date.now();

      await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });

      // Sleeping inside a run burns its whole deadline and risks it being
      // killed holding the conversations it already read. The schedule is the
      // retry.
      expect(Date.now() - startedAt).toBeLessThan(2_000);
      expect(costCalls()).toHaveLength(1);
    });
  });

  describe("when the cost read fails in any other way", () => {
    /** @scenario "A cost read that fails never costs the run its conversations" */
    it("degrades to no cost rather than failing the run", async () => {
      costReplies = [{ status: 500, body: {} }];

      const result = await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });

      expect(costEvents(result.events)).toHaveLength(0);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });

    /** @scenario "A cost read that fails never costs the run its conversations" */
    it("survives a reply that is not the shape it expects", async () => {
      costReplies = [{ status: 200, body: { nonsense: true } }];

      const result = await runPull({ azureSubscriptionId: SUBSCRIPTION_ID });

      expect(costEvents(result.events)).toHaveLength(0);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
    });
  });

  describe("when the stored position predates the cost read", () => {
    /** @scenario "A cursor written before cost existed is still read" */
    it("reads it as it always was and starts pricing from scratch", async () => {
      const oldCursor = JSON.stringify({
        createdon: "2026-08-20T10:00:00.000Z",
        conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
      });

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: oldCursor,
      });

      expect(result.errorCount).toBe(0);
      // It resumed the transcript walk from the old position rather than
      // treating the cursor as unreadable and re-reading the whole window.
      const transcriptCall = capturedCalls.find((c) =>
        c.url.includes("/conversationtranscripts"),
      );
      expect(decodeURIComponent(transcriptCall?.url ?? "")).toContain(
        "2026-08-20T10:00:00.000Z",
      );
      expect(costEvents(result.events)).toHaveLength(44);
    });
  });

  describe("when the run makes no progress of any kind", () => {
    /** @scenario "A cost read that fails never costs the run its conversations" */
    it("hands back the very same cursor string it was given", async () => {
      // The worker decides "did this run progress" by comparing the cursor
      // string it gets back against the one it passed in. Re-encoding an
      // unchanged position produces a DIFFERENT string — the cost fields are
      // now spelled out — and the worker would read that as an advance and
      // persist a run that read nothing.
      const previous = JSON.stringify({
        createdon: "2026-08-20T10:00:00.000Z",
        conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
      });
      transcriptStatus = 503;

      const result = await runPull({ cursor: previous });

      expect(result.cursor).toBe(previous);
    });

    /** @scenario "A cost read that fails never costs the run its conversations" */
    it("hands back the same string when it reported an error without throwing", async () => {
      // The genuinely dangerous shape, and the only one the two cases either
      // side of it do not reach: an unreadable row counts an error and the
      // walk does not throw, so the run returns normally with errorCount > 0
      // and no position of its own. The worker fails such a run ONLY if the
      // cursor came back unchanged.
      transcriptRows = [{ conversationtranscriptid: "not-a-uuid" }];
      const previous = JSON.stringify({
        createdon: "2026-08-20T10:00:00.000Z",
        conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
      });

      const result = await runPull({ cursor: previous });

      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.cursor).toBe(previous);
    });

    /** @scenario "Conversations failing after cost was read discards both" */
    it("does not let a cost advance stand in for transcript progress", async () => {
      // The nastiest shape of all. The transcript walk raised an error WITHOUT
      // throwing, so it made no progress — but the cost read succeeded and
      // moved its own watermark. A cursor that changed for the cost's sake
      // reads to the worker as "advanced past input it could not read", and it
      // would log a warning and persist a run that read no conversations at
      // all. Worst case, the error is `refusesNextLink` — a next-page link
      // pointing away from the customer's environment — and that refusal is
      // meant to fail the run loudly, not once a day quietly.
      transcriptRows = [{ conversationtranscriptid: "not-a-uuid" }];
      const previous = JSON.stringify({
        createdon: "2026-08-20T10:00:00.000Z",
        conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
      });

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: previous,
      });

      expect(result.errorCount).toBeGreaterThan(0);
      expect(result.cursor).toBe(previous);
    });

    /** @scenario "Being asked to slow down leaves the window unpriced rather than priced at nothing" */
    it("hands back the same string when only the cost read was held", async () => {
      // No transcript rows and no failure, so the walk genuinely makes no
      // progress without throwing — this has to reach the `moved` check
      // rather than the catch, or it proves nothing about it. The hold is
      // recent, so the cost cursor keeps the instant it already had instead
      // of taking the give-up branch and moving.
      const heldSinceMs = Date.now() - 60_000;
      const previous = JSON.stringify({
        createdon: "2026-08-20T10:00:00.000Z",
        conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
        costPricedThroughDay: "2026-08-29",
        costHeldSinceMs: heldSinceMs,
      });
      costReplies = [{ status: 429, body: {} }];
      transcriptRows = [];

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: previous,
      });

      expect(result.errorCount).toBe(0);
      expect(result.cursor).toBe(previous);
    });

    /** @scenario "A window held for too long is given up rather than held forever" */
    it("does move the cursor when a long-held window is finally given up", async () => {
      // The other side of the rule above: an unchanged cursor must not be the
      // answer to everything, or the give-up would never be persisted and the
      // window would be held forever.
      const previous = JSON.stringify({
        createdon: "2026-08-20T10:00:00.000Z",
        conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
        costPricedThroughDay: "2026-07-01",
        costHeldSinceMs: 1_000,
      });
      costReplies = [{ status: 429, body: {} }];
      transcriptRows = [];

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: previous,
      });

      expect(result.errorCount).toBe(0);
      expect(result.cursor).not.toBe(previous);
      const cursor = JSON.parse(String(result.cursor));
      expect(cursor).toHaveProperty("costHeldSinceMs", null);
      expect(cursor.costPricedThroughDay).not.toBe("2026-07-01");
    });
  });

  describe("when reading the conversations fails after the cost was read", () => {
    /** @scenario "Conversations failing after cost was read discards both" */
    it("reports the failure and keeps its transcript position", async () => {
      transcriptStatus = 503;

      const result = await runPull({
        azureSubscriptionId: SUBSCRIPTION_ID,
        cursor: JSON.stringify({
          createdon: "2026-08-20T10:00:00.000Z",
          conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
        }),
      });

      // The run failed, so the worker discards its events and retries the
      // same window. The transcript position must be exactly where it was, or
      // the retry would skip the conversations this run never read.
      expect(result.errorCount).toBeGreaterThan(0);
      const cursor = JSON.parse(String(result.cursor));
      expect(cursor.conversationtranscriptid).toBe(
        "22222222-2222-4222-8222-222222222222",
      );
      expect(cursor.createdon).toBe("2026-08-20T10:00:00.000Z");
    });
  });
});
