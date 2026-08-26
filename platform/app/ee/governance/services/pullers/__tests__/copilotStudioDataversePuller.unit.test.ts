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
let errors: string[] = [];
let transcripts: TranscriptTable | null = null;

/**
 * A transcript table that answers the query it is actually sent, instead of a
 * canned page.
 *
 * The cursor bugs worth testing here are ones a canned page cannot show. A
 * queued response comes back whatever the `$filter` says, so a filter that
 * re-reads rows it has already handed over — or walks in a circle over rows
 * sharing a timestamp — looks exactly like a correct one. This holds rows,
 * applies the filter the adapter built, sorts them the way the adapter asked,
 * and pages them, so a run that fails to move forward fails to move forward
 * here too.
 */
interface TranscriptTable {
  rows: Array<Record<string, unknown>>;
  /**
   * What the server hands back per page, independently of `$top`. A page ending
   * part-way through a group of same-instant rows is the whole point: it is
   * what leaves a cursor pointing into the middle of one.
   */
  pageSize: number;
  /**
   * Aborted once a page has been served, to strand a run mid-walk the way a
   * deadline does in production.
   */
  controller?: AbortController;
}

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

/**
 * Evaluate one OData `$filter` against one row.
 *
 * Deliberately generic over `and`, `or`, brackets and the comparison
 * operators rather than looking for the predicate the adapter happens to build
 * today. A matcher written to recognise the correct filter would report the
 * incorrect one as "no rows match" and pass every test for the wrong reason;
 * this one runs whatever the adapter emits and lets the rows say whether it
 * was right.
 */
function evaluateFilter(filter: string, row: Record<string, unknown>): boolean {
  const tokens = filter
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length > 0);
  let at = 0;

  function compare(field: string, operator: string, literal: string): boolean {
    const raw = row[field];
    if (typeof raw !== "string") return false;
    // Every column this adapter filters on is a guid or a datetime, and
    // Dataverse refuses to compare either against a string literal — "a binary
    // operator with incompatible types was detected", answered as an HTTP 400
    // that names neither the column nor the filter. So a quote here is the
    // adapter emitting a query the real server would reject, and the double
    // has to say so rather than quietly stripping it: a double more permissive
    // than the server it stands in for is how the agent-id filter shipped
    // broken behind a full green suite.
    if (literal.startsWith("'") || literal.endsWith("'")) {
      throw new Error(
        `Dataverse would refuse "${field} ${operator} ${literal}": a quoted ` +
          "literal against a non-string column",
      );
    }
    const value = literal;
    const order =
      field === "createdon"
        ? Math.sign(Date.parse(raw) - Date.parse(value))
        : stringOrder(raw, value);
    if (operator === "eq") return order === 0;
    if (operator === "ne") return order !== 0;
    if (operator === "gt") return order > 0;
    if (operator === "ge") return order >= 0;
    if (operator === "lt") return order < 0;
    if (operator === "le") return order <= 0;
    throw new Error(`test bug: unknown filter operator ${operator}`);
  }

  function readFactor(): boolean {
    if (tokens[at] === "(") {
      at += 1;
      const inner = readExpression();
      if (tokens[at] !== ")") throw new Error("test bug: unbalanced filter");
      at += 1;
      return inner;
    }
    const field = tokens[at]!;
    const operator = tokens[at + 1]!;
    const literal = tokens[at + 2]!;
    at += 3;
    return compare(field, operator, literal);
  }

  function readTerm(): boolean {
    let result = readFactor();
    while (tokens[at] === "and") {
      at += 1;
      // Both sides are read before they are combined: short-circuiting would
      // leave the right-hand tokens unconsumed and desynchronise the parse.
      result = readFactor() && result;
    }
    return result;
  }

  function readExpression(): boolean {
    let result = readTerm();
    while (tokens[at] === "or") {
      at += 1;
      result = readTerm() || result;
    }
    return result;
  }

  const matched = readExpression();
  if (at !== tokens.length)
    throw new Error(`test bug: unread filter ${filter}`);
  return matched;
}

function stringOrder(left: string, right: string): number {
  if (left < right) return -1;
  return left > right ? 1 : 0;
}

/** The order the adapter's `$orderby` asks for, applied by the fake server. */
function byCursorOrder(
  a: Record<string, unknown>,
  b: Record<string, unknown>,
): number {
  const byTime =
    Date.parse(String(a.createdon)) - Date.parse(String(b.createdon));
  if (byTime !== 0) return byTime;
  return stringOrder(
    String(a.conversationtranscriptid),
    String(b.conversationtranscriptid),
  );
}

function serveTranscriptPage(
  url: string,
  table: TranscriptTable,
): Record<string, unknown> {
  const parsed = new URL(url);
  const filter = parsed.searchParams.get("$filter") ?? "";
  const offset = Number(parsed.searchParams.get("$skiptoken") ?? "0");

  const matching = table.rows
    .filter((row) => evaluateFilter(filter, row))
    .sort(byCursorOrder);
  const page = matching.slice(offset, offset + table.pageSize);

  const body: Record<string, unknown> = { value: page };
  if (offset + page.length < matching.length) {
    parsed.searchParams.set("$skiptoken", String(offset + page.length));
    body["@odata.nextLink"] = parsed.toString();
  }
  // Aborted after the page, so this run keeps what it just read and stops
  // before asking for the next one — a deadline landing mid-walk, which is how
  // a cursor comes to rest inside a group of same-instant rows.
  table.controller?.abort();
  return body;
}

function transcriptRow(overrides: Record<string, unknown> = {}) {
  return {
    conversationtranscriptid: "11111111-1111-4111-8111-111111111111",
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
  errors = [];
  transcripts = null;
  // The logger is captured because one of this adapter's promises is a
  // diagnostic one: the misconfiguration it has to survive is also the one it
  // has to name, and a warning nobody asserts is a warning that can be
  // deleted without a single test noticing.
  vi.doMock("@langwatch/observability", async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    createLogger: () => ({
      warn: (...args: unknown[]) => warnings.push(args.map(String).join(" ")),
      error: (...args: unknown[]) => errors.push(args.map(String).join(" ")),
      info: () => undefined,
      debug: () => undefined,
    }),
  }));
  vi.doMock("~/utils/ssrfProtection", () => ({
    RedirectRefusedError,
    ssrfSafeFetch: async (url: string, init?: RequestInit) => {
      capturedCalls.push({ url, init });
      if (transcripts && url.includes("/conversationtranscripts")) {
        return new Response(
          JSON.stringify(serveTranscriptPage(url, transcripts)),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
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
            conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
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

describe("given a config naming which agents to read", () => {
  const SECOND_BOT_ID = "5f1b0a2e-1111-4000-8000-0000000000ab";

  it("names each agent id in the filter as a bare guid", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    transcripts = { rows: [transcriptRow()], pageSize: 10 };

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig({ ...CONFIG, botIds: [BOT_ID, SECOND_BOT_ID] }),
    );

    // The row still arrives: the filter the adapter built is one the server
    // ran, rather than one it refused. This is the half a `toContain` on the
    // URL cannot see — a quoted id reads perfectly well as a string and is
    // answered with an HTTP 400.
    expect(result.errorCount).toBe(0);
    expect(result.events).toHaveLength(1);

    const query = decodeURIComponent(transcriptCall().url);
    expect(query).toContain(
      `(_bot_conversationtranscriptid_value eq ${BOT_ID} or ` +
        `_bot_conversationtranscriptid_value eq ${SECOND_BOT_ID})`,
    );
    // The column is an `Edm.Guid`. Dataverse compares one against a guid
    // literal and refuses to compare it against a string, so the quotes that
    // would be right for a name are the whole failure here.
    expect(query).not.toContain(`eq '${BOT_ID}'`);
  });

  it("refuses an agent id that is not a guid at validation rather than at run time", async () => {
    const adapter = await newAdapter();

    // Whatever someone typed, it cannot go into the filter unquoted, and it
    // cannot go in quoted either. Saying so here names the field; letting it
    // through spends a run to be told "incompatible types" by a server that
    // mentions no field at all.
    expect(() =>
      adapter.validateConfig({ ...CONFIG, botIds: ["engineering-agent"] }),
    ).toThrow();
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
          conversationtranscriptid: "11111111-1111-4111-8111-111111111111",
        }),
        credentials: CREDENTIALS,
      },
      adapter.validateConfig(CONFIG),
    );

    const query = decodeURIComponent(transcriptCall().url);
    expect(query).toContain("createdon ge 2026-08-25T19:44:43Z");
    // Everything strictly after the pair, never "at or after the timestamp,
    // minus one id": the second is not a total order and walks in circles on
    // a timestamp holding several rows.
    expect(query).toContain(
      "(createdon gt 2026-08-25T19:44:43Z or " +
        "(createdon eq 2026-08-25T19:44:43Z and " +
        "conversationtranscriptid gt 11111111-1111-4111-8111-111111111111))",
    );
    expect(query).not.toContain("conversationtranscriptid ne");
  });

  it("asks for the order its continuation predicate assumes", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    // The predicate above is only a continuation under exactly this sort. The
    // two are asserted together because a change to either one alone silently
    // starts skipping rows.
    expect(decodeURIComponent(transcriptCall().url)).toContain(
      "$orderby=createdon asc,conversationtranscriptid asc",
    );
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
            conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
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
      conversationtranscriptid: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("leaves the cursor alone when the run found nothing", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [] } });

    const cursor = JSON.stringify({
      createdon: "2026-08-25T19:44:43Z",
      conversationtranscriptid: "11111111-1111-4111-8111-111111111111",
    });
    const result = await adapter.runOnce(
      { cursor, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.cursor).toBe(cursor);
  });
});

describe("given several conversations written in the same instant", () => {
  // Two rows one second apart would tell us nothing: the timestamp alone
  // separates them. These three share an instant between the first two, which
  // is where a cursor that is not a total order starts going round in circles.
  const SAME_INSTANT = "2026-08-25T19:44:43Z";
  const LATER = "2026-08-25T19:45:12Z";
  const ROWS = [
    transcriptRow({
      conversationtranscriptid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      createdon: SAME_INSTANT,
    }),
    transcriptRow({
      conversationtranscriptid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      createdon: SAME_INSTANT,
    }),
    transcriptRow({ conversationtranscriptid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", createdon: LATER }),
  ];

  /**
   * One run against the fake table, stopped after its first page.
   *
   * The stop is what makes this worth testing: a run that walks every page
   * always ends on the last row and hides the problem. Stranded on `row-a`
   * with `row-b` still to come, the next run has to continue past the whole
   * pair, not merely past the id.
   */
  async function runStoppingAfterOnePage(
    adapter: Awaited<ReturnType<typeof newAdapter>>,
    cursor: string | null,
  ) {
    const controller = new AbortController();
    queueSignInAndBots();
    transcripts = { rows: ROWS, pageSize: 1, controller };

    return adapter.runOnce(
      { cursor, credentials: CREDENTIALS, signal: controller.signal },
      adapter.validateConfig(CONFIG),
    );
  }

  it("reaches every conversation exactly once across restarts", async () => {
    const adapter = await newAdapter();
    const seen: string[] = [];
    let cursor: string | null = null;

    for (let run = 0; run < 3; run += 1) {
      const result = await runStoppingAfterOnePage(adapter, cursor);
      seen.push(...result.events.map((event) => event.source_event_id));
      cursor = result.cursor;
    }

    // Not a set: the failure this guards against is a run handing back a row
    // it already delivered, and a set would swallow exactly that. With a
    // cursor that keeps every same-instant row but the saved id, the third
    // run answers with `row-a` again and the pair alternates forever without
    // `row-c` ever being read.
    expect(seen).toEqual(["aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "cccccccc-cccc-4ccc-8ccc-cccccccccccc"]);
  });

  it("advances the cursor strictly forward on every restart", async () => {
    const adapter = await newAdapter();
    const cursors: unknown[] = [];
    let cursor: string | null = null;

    for (let run = 0; run < 3; run += 1) {
      const result = await runStoppingAfterOnePage(adapter, cursor);
      cursor = result.cursor;
      cursors.push(JSON.parse(cursor!));
    }

    expect(cursors).toEqual([
      { createdon: SAME_INSTANT, conversationtranscriptid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { createdon: SAME_INSTANT, conversationtranscriptid: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      { createdon: LATER, conversationtranscriptid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" },
    ]);
  });

  it("resumes at the next row when a page ended between two of them", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    // A page that ended on `row-a`, leaving `row-b` unread at the same instant.
    transcripts = { rows: ROWS, pageSize: 10 };

    const result = await adapter.runOnce(
      {
        cursor: JSON.stringify({
          createdon: SAME_INSTANT,
          conversationtranscriptid: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        }),
        credentials: CREDENTIALS,
      },
      adapter.validateConfig(CONFIG),
    );

    expect(result.events.map((event) => event.source_event_id)).toEqual([
      "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    ]);
    expect(JSON.parse(result.cursor!)).toEqual({
      createdon: LATER,
      conversationtranscriptid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
  });

  it("delivers nothing more once the cursor is past the last row", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    transcripts = { rows: ROWS, pageSize: 10 };

    const cursor = JSON.stringify({
      createdon: LATER,
      conversationtranscriptid: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    const result = await adapter.runOnce(
      { cursor, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.events).toHaveLength(0);
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
      conversationtranscriptid: "11111111-1111-4111-8111-111111111111",
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
    // Asserted on what the logger was handed, not on the result: `PullResult`
    // carries events, a cursor and a count and has never had anywhere to put a
    // message, so `JSON.stringify(result)` could not have contained the secret
    // however badly the failure path leaked it. The log line is where the
    // reason actually travels, and the source page shows it.
    expect(errors.join("\n")).toContain("copilot studio dataverse pull failed");
    expect(errors.join("\n")).not.toContain(CREDENTIALS.clientSecret);
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

  /**
   * An entry that is not an object at all is no more readable than one that
   * fails the schema, and it used to be dropped by a bare `continue`. A page
   * of those then came back as zero events, zero errors and an unmoved cursor
   * — which the worker reads as a source with nothing in it, so nobody ever
   * learns the rows were discarded.
   */
  it("counts a page entry that is not a row at all", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({
      status: 200,
      body: { value: [null, "not a row", 42] },
    });

    const result = await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(result.errorCount).toBe(3);
    expect(result.events).toHaveLength(0);
  });

  /**
   * The cursor is interpolated bare into the next run's `$filter`, so what
   * comes back out of storage has to be the shape that goes in. A stored value
   * that is not restarts the window instead: re-reading is survivable because
   * every identifier is derived, where replaying a broken predicate is a run
   * that fails identically forever with nothing moving.
   */
  it("restarts the window rather than replay a cursor it cannot use", async () => {
    const adapter = await newAdapter();
    queueSignInAndBots();
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    await adapter.runOnce(
      {
        cursor: JSON.stringify({
          createdon: "2026-08-25T19:44:43Z",
          conversationtranscriptid: "row-1 or 1 eq 1",
        }),
        credentials: CREDENTIALS,
      },
      adapter.validateConfig(CONFIG),
    );

    const query = decodeURIComponent(transcriptCall().url);
    expect(query).not.toContain("1 eq 1");
    // The first-run window, not a continuation: the stored pair was refused,
    // so there is nothing to continue from.
    expect(query).toContain("createdon ge");
    expect(query).not.toContain("createdon gt");
  });
});
