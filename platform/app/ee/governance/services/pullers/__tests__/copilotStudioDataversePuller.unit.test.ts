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

function transcriptRow(overrides: Record<string, unknown> = {}) {
  return {
    conversationtranscriptid: "row-1",
    name: "b957a08c-0000-4000-8000-000000000001_dacfd251-bot",
    conversationstarttime: "2026-08-25T19:14:34Z",
    createdon: "2026-08-25T19:44:43Z",
    metadata: JSON.stringify({ BotId: "dacfd251-bot", BatchId: 0 }),
    content: JSON.stringify({ activities: [] }),
    bot_conversationtranscriptid: {
      name: "engineering-agent",
      modifiedon: "2026-08-20T10:00:00Z",
    },
    ...overrides,
  };
}

beforeEach(() => {
  capturedCalls = [];
  responseQueue = [];
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

function queueSignIn() {
  responseQueue.push({ status: 200, body: { access_token: "token-xyz" } });
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

describe("given a run against an environment holding one conversation", () => {
  /** @scenario "The puller never reaches beyond the customer's environment" */
  it("reaches only the sign-in and the environment, never the directory", async () => {
    const adapter = await newAdapter();
    queueSignIn();
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    expect(capturedCalls).toHaveLength(2);
    for (const call of capturedCalls) {
      expect(call.url).not.toContain("graph.microsoft.com");
    }
    expect(capturedCalls[0]!.url).toContain("login.microsoftonline.com");
    expect(capturedCalls[1]!.url).toContain(ENVIRONMENT_URL);
    expect(capturedCalls[1]!.url).toContain("conversationtranscripts");
  });

  /** @scenario "A redirect never carries the credentials onward" */
  it("opts out of redirects on every call that carries a credential", async () => {
    const adapter = await newAdapter();
    queueSignIn();
    responseQueue.push({ status: 200, body: { value: [transcriptRow()] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    for (const call of capturedCalls) {
      expect(call.init?.followRedirects).toBe(false);
    }
  });

  it("hands each row on with the agent's name and last-changed time", async () => {
    const adapter = await newAdapter();
    queueSignIn();
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

  it("asks only for the last thirty days on a first run", async () => {
    const adapter = await newAdapter();
    queueSignIn();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    const query = decodeURIComponent(capturedCalls[1]!.url);
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
    queueSignIn();
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

    const query = decodeURIComponent(capturedCalls[1]!.url);
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
    queueSignIn();
    responseQueue.push({ status: 200, body: { value: [] } });

    await adapter.runOnce(
      { cursor: null, credentials: CREDENTIALS },
      adapter.validateConfig(CONFIG),
    );

    const filter = /\$filter=([^&]*)/.exec(capturedCalls[1]!.url)?.[1] ?? "";
    expect(filter).toContain("%20");
    expect(filter).not.toContain("+");
  });

  it("advances the cursor to the last row it actually read", async () => {
    const adapter = await newAdapter();
    queueSignIn();
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
    queueSignIn();
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
    queueSignIn();
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
    queueSignIn();
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
