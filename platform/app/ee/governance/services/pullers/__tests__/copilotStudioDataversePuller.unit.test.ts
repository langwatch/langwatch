// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The Dataverse adapter's own contract: where it sends the credential, what
 * it asks for, and what it does when the pull goes wrong.
 *
 * The fetch helper is mocked at the module boundary so every outbound call is
 * captured. That is the only way to assert the two properties that matter
 * most here and cannot be seen from the returned events: that no request goes
 * anywhere near Microsoft's directory service, and that each request opts out
 * of redirect-following before a credential travels with it.
 *
 * Spec: specs/ai-governance/puller-framework/copilot-studio-dataverse.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectRefusedError } from "~/utils/ssrfProtection";

interface FetchCall {
  url: string;
  init: (RequestInit & { followRedirects?: boolean }) | undefined;
}

let capturedCalls: FetchCall[] = [];
let responseQueue: Array<{ status: number; body: unknown }> = [];
let warnings: string[] = [];

const ENVIRONMENT_URL = "https://org12345.crm.dynamics.com";
const CREDENTIALS = {
  tenantId: "3807ec24-0000-4000-8000-000000000001",
  clientId: "app-client-id",
  clientSecret: "app-client-secret",
};

const CONFIG = {
  adapter: "copilot_studio_dataverse" as const,
  environmentUrl: ENVIRONMENT_URL,
  botIds: [],
};

const BOT_ID = "cc7bc3b3-dfd8-4bd9-b637-eac033f399e2";

function transcriptRow(overrides: Record<string, unknown> = {}) {
  return {
    conversationtranscriptid: "row-1",
    name: "b957a08c-0000-4000-8000-000000000001_dacfd251-bot",
    conversationstarttime: "2026-08-25T19:14:34Z",
    createdon: "2026-08-25T19:44:43Z",
    // `metadata.BotId` is deliberately not `BOT_ID`. On a real row those two
    // differ, and only the lookup column joins to the agent — a fixture that
    // made them equal would let a mix-up pass.
    metadata: JSON.stringify({ BotId: "dacfd251-bot", BatchId: 0 }),
    content: JSON.stringify({ activities: [] }),
    _bot_conversationtranscriptid_value: BOT_ID,
    ...overrides,
  };
}

function botRow(overrides: Record<string, unknown> = {}) {
  return {
    botid: BOT_ID,
    name: "engineering-agent",
    modifiedon: "2026-08-20T10:00:00Z",
    ...overrides,
  };
}

beforeEach(() => {
  capturedCalls = [];
  responseQueue = [];
  warnings = [];
  // The logger is captured because one of this adapter's promises is a
  // diagnostic one: the misconfiguration it has to survive is also the one it
  // has to name, and a warning nobody asserts is a warning that can be
  // deleted without a single test noticing.
  vi.doMock("@langwatch/observability", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createLogger: () => ({
      warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
      error: () => undefined,
      info: () => undefined,
      debug: () => undefined,
    }),
  }));
  vi.doMock("~/utils/ssrfProtection", () => ({
    RedirectRefusedError,
    ssrfSafeFetch: async (url: string, init?: RequestInit) => {
      capturedCalls.push({ url, init });
      const next = responseQueue.shift();
      if (!next) throw new Error("test bug: no queued response");
      return new Response(JSON.stringify(next.body), {
        status: next.status,
        headers: { "content-type": "application/json" },
      });
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function newAdapter() {
  const { CopilotStudioDataversePuller } = await import(
    "../copilotStudioDataverse.puller"
  );
  return new CopilotStudioDataversePuller();
}

/**
 * The two reads every run makes before it asks for a transcript: the sign-in,
 * then the agent list it joins names from. Queued together because no run
 * reaches a transcript without both, so a test that queues one and not the
 * other is testing a sequence that cannot happen.
 */
function queueSignInAndBots(bots: unknown[] = [botRow()]) {
  responseQueue.push({ status: 200, body: { access_token: "token-xyz" } });
  responseQueue.push({ status: 200, body: { value: bots } });
}

/**
 * The first read of the transcript table, found by what it asks for rather
 * than by its position in the queue. Counting calls means every test breaks
 * the day the run makes one more of them, and a test that breaks for that
 * reason teaches nobody anything.
 */
function transcriptCall() {
  const call = capturedCalls.find((c) =>
    c.url.includes("/conversationtranscripts"),
  );
  if (!call) throw new Error("test bug: the run never read the transcripts");
  return call;
}

describe("given a config naming an environment", () => {
  describe("when it is validated", () => {
    it("accepts a real Power Platform address", async () => {
      const adapter = await newAdapter();
      expect(() => adapter.validateConfig(CONFIG)).not.toThrow();
    });

    /** @scenario "An environment address that is not secure is refused at save time" */
    it("refuses an insecure address even though the schema calls it a URL", async () => {
      const adapter = await newAdapter();
      expect(() =>
        adapter.validateConfig({
          ...CONFIG,
          environmentUrl: "http://org12345.crm.dynamics.com",
        }),
      ).toThrow(/Power Platform environment address/);
    });

    /** @scenario "An environment address Microsoft does not host is refused at save time" */
    it("refuses an address Microsoft does not serve", async () => {
      const adapter = await newAdapter();
      expect(() =>
        adapter.validateConfig({
          ...CONFIG,
          environmentUrl: "https://attacker.example.com",
        }),
      ).toThrow(/Power Platform environment address/);
    });
  });
});

describe("given a response steering the next page somewhere else", () => {
  it("refuses a next-page link outside the environment host", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({
      status: 200,
      body: {
        value: [transcriptRow()],
        "@odata.nextLink": "https://attacker.example/page2",
      },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    // Three calls, not four: the sign-in, the agent list and the first page.
    // A fourth would have sent the access token to the attacker's host, which
    // `followRedirects: false` stops on a redirect and nothing stopped here.
    expect(capturedCalls).toHaveLength(3);
    for (const call of capturedCalls) {
      expect(call.url).not.toContain("attacker.example");
    }
    // The page that did arrive is kept — a bad link ahead is not a reason to
    // throw away rows already read.
    expect(result.events).toHaveLength(1);
    expect(result.errorCount).toBe(1);
  });

  /** @scenario "A next page cannot move the token to another tenant" */
  it("refuses a next-page link to a different Dataverse environment", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({
      status: 200,
      body: {
        value: [transcriptRow()],
        // A real Power Platform address, served by Microsoft, passing every
        // suffix the allowlist holds — and belonging to somebody else.
        "@odata.nextLink":
          "https://org99999.crm.dynamics.com/api/data/v9.2/conversationtranscripts?$skiptoken=x",
      },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    // The sign-in, the agent list and the first page, and nothing after: the
    // request that would have followed this link carries the bearer token.
    expect(capturedCalls).toHaveLength(3);
    for (const call of capturedCalls) {
      expect(call.url).not.toContain("org99999");
    }
    expect(result.events).toHaveLength(1);
    expect(result.errorCount).toBe(1);
  });

  it("follows a next-page link that stays on the environment host", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({
      status: 200,
      body: {
        value: [transcriptRow()],
        "@odata.nextLink":
          "https://org12345.crm.dynamics.com/api/data/v9.2/conversationtranscripts?$skiptoken=x",
      },
    });
    responseQueue.push({ status: 200, body: { value: [] } });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(capturedCalls).toHaveLength(4);
    expect(capturedCalls.at(-1)!.url).toContain("$skiptoken=x");
    expect(result.errorCount).toBe(0);
  });
});

describe("given a run against an environment holding one conversation", () => {
  /** @scenario "The puller never reaches beyond the customer's environment" */
  it("reaches only the sign-in and the environment, never the directory", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(capturedCalls).toHaveLength(3);
    for (const call of capturedCalls) {
      expect(call.url).not.toContain("graph.microsoft.com");
    }
    expect(capturedCalls[0]!.url).toContain("login.microsoftonline.com");
    expect(transcriptCall().url).toContain(ENVIRONMENT_URL);
    expect(transcriptCall().url).toContain("conversationtranscripts");
  });

  /** @scenario "A redirect never carries the credentials onward" */
  it("opts out of redirects on every call that carries a credential", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    // Asserted before the loop: a `for` over an empty list passes without
    // checking anything, which is how a test like this stops being one.
    expect(capturedCalls).toHaveLength(3);
    for (const call of capturedCalls) {
      expect(call.init?.followRedirects).toBe(false);
    }
  });

  it("hands each row on with the agent's name and last-changed time", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.action).toBe("copilot_conversation");
    expect(result.events[0]!.extra).toMatchObject({
      botName: "engineering-agent",
      botModifiedOn: "2026-08-20T10:00:00Z",
    });
    // A transcript row has no single author — attribution lives on the turns
    // inside it, which is where the account identifier actually appears.
    expect(result.events[0]!.actor).toBe("");
  });

  it("asks for the agent as a lookup id rather than asking Dataverse to join", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    const query = decodeURIComponent(transcriptCall().url);
    expect(query).toContain("_bot_conversationtranscriptid_value");
    // An `$expand` here has to name a navigation property, and naming one that
    // the environment does not have is answered with a 400 on the very first
    // page — every run, for every customer, with the reads that were proven
    // against a real environment all avoiding it.
    expect(query).not.toContain("$expand");
  });

  /** @scenario "A conversation is named from the agent table, not from its own metadata" */
  it("names a conversation from its agent lookup and never from its metadata", async () => {
    const adapter = await newAdapter();
    // The agent list holds two agents: the one the lookup column points at,
    // and one carrying the id the row's `metadata` claims. Joining on the
    // wrong field would find the second and put a confident, wrong name on
    // the conversation instead of leaving it unnamed.
    queueSignInAndBots([
      botRow(),
      botRow({ botid: "dacfd251-bot", name: "wrong-agent" }),
    ]);
    responseQueue.push({
      status: 200,
      body: {
        value: [
          transcriptRow(),
          transcriptRow({
            conversationtranscriptid: "row-2",
            _bot_conversationtranscriptid_value:
              "00000000-0000-4000-8000-00000000dead",
          }),
        ],
      },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.events).toHaveLength(2);
    // Matched by the lookup: named.
    expect(result.events[0]!.extra).toMatchObject({
      botName: "engineering-agent",
    });
    // Its metadata still says `dacfd251-bot`, and an agent by that id is
    // sitting in the list — so a name here at all would be the bug.
    expect(result.events[1]!.extra?.botName).toBeUndefined();
    expect(result.events[1]!.target).toBe("");
  });

  it("matches the agent whatever case the two sides spell the id in", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots([botRow({ botid: BOT_ID.toUpperCase() })]);
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.events[0]!.extra).toMatchObject({
      botName: "engineering-agent",
    });
  });

  /** @scenario "A run that cannot read the agent list still delivers its conversations" */
  it("keeps the conversations when the agent list cannot be read", async () => {
    const adapter = await newAdapter();
    responseQueue.push({ status: 200, body: { access_token: "token-xyz" } });
    responseQueue.push({ status: 403, body: { error: "no" } });
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    // Nameless, but delivered, and above all not counted as an error. A
    // non-zero count makes the worker throw the run's events away and leave
    // the cursor where it was, so counting this would mean a source that can
    // never read the agent list is a source that never moves at all.
    expect(result.errorCount).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.extra?.botName).toBeUndefined();
    expect(result.cursor).not.toBe(null);
  });

  /** @scenario "A run that cannot read the agent list still delivers its conversations" */
  it("says so when the environment answers the agent list with no agents", async () => {
    const adapter = await newAdapter();
    // Not a refusal. A credential that reads the agent table at the wrong
    // depth is answered with success and an empty list, because the
    // application user owns none of the rows. That is the same answer a
    // tenant with no agents gives, and it is the likelier of the two here:
    // these conversations were written by an agent.
    queueSignInAndBots([]);
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(0);
    expect(result.events).toHaveLength(1);
    expect(result.events[0]!.extra?.botName).toBeUndefined();
    expect(warnings.join("\n")).toContain("no agents at all");
  });

  it("asks only for the last thirty days on a first run", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    const query = decodeURIComponent(transcriptCall().url);
    const since = /createdon ge ([^ &]+)/.exec(query)?.[1];
    const days = (Date.now() - Date.parse(since!)) / 86_400_000;
    // Microsoft deletes transcripts on a schedule about a month out, so
    // asking further back only spends the run on rows that are not there.
    expect(days).toBeGreaterThan(29);
    expect(days).toBeLessThan(31);
  });
});

describe("given a cursor from a previous run", () => {
  it("resumes from it and excludes the row it already read", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      {
        cursor: JSON.stringify({
          createdon: "2026-08-25T19:44:43Z",
          conversationtranscriptid: "row-1",
        }),
        credentials: CREDENTIALS,
      },
      adapter.validateConfig(CONFIG),
    );

    const query = decodeURIComponent(transcriptCall().url);
    expect(query).toContain("createdon ge 2026-08-25T19:44:43Z");
    // `ge` plus an explicit exclusion, not `gt`: rows written in the same
    // instant would otherwise be skipped.
    expect(query).toContain("conversationtranscriptid ne row-1");
  });

  /**
   * OData specifies percent-encoding. The obvious way to build this query,
   * `URLSearchParams`, encodes a space as `+` — form encoding — which leaves
   * the filter at the mercy of how the server chooses to read it.
   */
  it("percent-encodes the spaces in the filter rather than sending plus signs", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    const filter = /\$filter=([^&]*)/.exec(transcriptCall().url)?.[1] ?? "";
    expect(filter).toContain("%20");
    expect(filter).not.toContain("+");
  });

  it("advances the cursor to the last row it actually read", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({
      status: 200,
      body: {
        value: [
          transcriptRow(),
          transcriptRow({
            conversationtranscriptid: "row-2",
            createdon: "2026-08-25T19:45:12Z",
          }),
        ],
      },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(JSON.parse(result.cursor!)).toEqual({
      createdon: "2026-08-25T19:45:12Z",
      conversationtranscriptid: "row-2",
    });
  });

  it("leaves the cursor alone when the run found nothing", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    const cursor = JSON.stringify({
      createdon: "2026-08-25T19:44:43Z",
      conversationtranscriptid: "row-1",
    });
    const result = await adapter.runOnce(
      { cursor, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.cursor).toBe(cursor);
  });
});

describe("given the pull goes wrong", () => {
  it("reports missing credentials rather than calling anything", async () => {
    const adapter = await newAdapter();
    const result = await adapter.runOnce(
      { cursor: null, credentials: { clientId: "only-half" } },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(1);
    expect(capturedCalls).toHaveLength(0);
  });

  it("does not advance the cursor when the environment refuses the read", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 403, body: {} });

    const cursor = JSON.stringify({
      createdon: "2026-08-25T19:44:43Z",
      conversationtranscriptid: "row-1",
    });
    const result = await adapter.runOnce(
      { cursor, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(1);
    expect(result.cursor).toBe(cursor);
  });

  /**
   * A token endpoint may echo the request back in its error body, and this
   * reason is logged and shown on the source, so only the status travels.
   */
  it("never repeats the sign-in response body in the failure", async () => {
    const adapter = await newAdapter();
    responseQueue.push({
      status: 401,
      body: { error_description: `secret was ${CREDENTIALS.clientSecret}` },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(1);
    expect(JSON.stringify(result)).not.toContain(CREDENTIALS.clientSecret);
  });

  it("counts a row it cannot read without losing the rest of the page", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({
      status: 200,
      body: { value: [{ nothing: "useful" }, transcriptRow()] },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(1);
    expect(result.events).toHaveLength(1);
  });
});
