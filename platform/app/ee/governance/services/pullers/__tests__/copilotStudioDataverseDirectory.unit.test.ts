// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The directory read living inside the Dataverse source.
 *
 * The same two rules the seat read is held to: it degrades rather than
 * throwing (an error count against an unmoved cursor discards the run whole,
 * conversations included), and it neither holds nor is held by the other
 * reads. Plus its own two: it is OFF unless switched on — the User.Read.All
 * consent hands this source every name in the tenant, and an admin should
 * turn that on deliberately — and its page walk is all or nothing, because a
 * directory reported from half its pages would list half the tenant with
 * nothing marking the rest missing.
 *
 * Spec: specs/governance/governance-people-discovery.feature
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RedirectRefusedError } from "~/utils/ssrfProtection";

interface FetchCall {
  url: string;
  init: (RequestInit & { followRedirects?: boolean }) | undefined;
}

const ENVIRONMENT_URL = "https://org12345.crm.dynamics.com";
const CREDENTIALS = {
  tenantId: "aaaaaaaa-0000-4000-8000-000000000001",
  clientId: "app-client-id",
  clientSecret: "app-client-secret",
};
const BOT_ID = "bbbbbbbb-0000-4000-8000-000000000002";
const USER_ID = "f6481ec4-e30f-4bf3-954f-2a8f29bb1c4a";
const SECOND_USER_ID = "0a2b3c4d-0000-4000-8000-000000000009";

const today = () => new Date().toISOString().slice(0, 10);

let capturedCalls: FetchCall[] = [];
let warnings: string[] = [];
let errors: string[] = [];
/** What Graph answers each successive /users call with. */
let usersReplies: Array<{ status: number; body: unknown }> = [];

function captured(args: unknown[]): string {
  return args
    .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
    .join(" ");
}

const graphUser = (over: Record<string, unknown> = {}) => ({
  id: USER_ID,
  displayName: "Maria Silva",
  mail: "m.silva@acme.test",
  userPrincipalName: "m.silva@acme.test",
  department: "Engineering",
  accountEnabled: true,
  ...over,
});

function transcriptRow() {
  return {
    conversationtranscriptid: "11111111-1111-4111-8111-111111111111",
    name: "cccccccc-0000-4000-8000-000000000003_agent-one",
    conversationstarttime: "2026-08-25T19:14:34Z",
    createdon: "2026-08-25T19:44:43Z",
    metadata: JSON.stringify({ BotId: "agent-one", BatchId: 0 }),
    content: JSON.stringify({ activities: [] }),
    _bot_conversationtranscriptid_value: BOT_ID,
  };
}

beforeEach(() => {
  capturedCalls = [];
  warnings = [];
  errors = [];
  usersReplies = [];

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

      if (url.includes("login.microsoftonline.com")) {
        return new Response(JSON.stringify({ access_token: "a-token" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("graph.microsoft.com")) {
        const next = usersReplies.shift() ?? {
          status: 200,
          body: { value: [graphUser()] },
        };
        return new Response(JSON.stringify(next.body), {
          status: next.status,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.includes("/bots")) {
        return new Response(
          JSON.stringify({ value: [{ botid: BOT_ID, name: "eng-agent" }] }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify({ value: [transcriptRow()] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  }));
});

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

async function runPull({
  readDirectory,
  cursor = null,
}: {
  readDirectory?: boolean;
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
      // Licences off so every Graph call in these tests is the directory's.
      readSeats: false,
      ...(readDirectory === undefined ? {} : { readDirectory }),
    },
  );
}

const usersCalls = () =>
  capturedCalls.filter((call) => call.url.includes("/v1.0/users"));
const directoryEvents = <T extends { action: string }>(events: T[]) =>
  events.filter((event) => event.action === "directory_report");
const conversationEvents = <T extends { action: string }>(events: T[]) =>
  events.filter((event) => event.action !== "directory_report");
const storedDirectoryDay = (cursor: string | null): string | null =>
  cursor ? (JSON.parse(cursor).directoryReportedThroughDay ?? null) : null;

describe("the directory read inside the Dataverse source", () => {
  describe("when nobody has switched it on", () => {
    /** @scenario "The directory is not read unless switched on" */
    it("asks Graph nothing, by default and when off explicitly", async () => {
      await runPull({});
      expect(usersCalls()).toHaveLength(0);

      await runPull({ readDirectory: false });
      expect(usersCalls()).toHaveLength(0);
    });
  });

  describe("when the source reads the directory", () => {
    it("records a directory event per user beside the conversations", async () => {
      const result = await runPull({ readDirectory: true });

      const directory = directoryEvents(result.events);
      expect(directory).toHaveLength(1);
      expect(directory[0]).toMatchObject({
        actor: USER_ID,
        target: "Engineering",
      });
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      expect(storedDirectoryDay(result.cursor)).toBe(today());
    });

    it("selects only the fields it records, and keeps the token off redirects", async () => {
      await runPull({ readDirectory: true });
      const [call] = usersCalls();

      expect(call?.url).toContain(
        "$select=id,displayName,mail,userPrincipalName,department,accountEnabled",
      );
      expect(call?.init?.followRedirects).toBe(false);
    });

    /** @scenario "The directory is read once a day, not once a tick" */
    it("asks nothing on a day already reported", async () => {
      const first = await runPull({ readDirectory: true });
      expect(usersCalls()).toHaveLength(1);

      await runPull({ readDirectory: true, cursor: first.cursor });
      expect(usersCalls()).toHaveLength(1);
    });

    it("follows Graph's own next link and records both pages as one day", async () => {
      usersReplies = [
        {
          status: 200,
          body: {
            value: [graphUser()],
            "@odata.nextLink":
              "https://graph.microsoft.com/v1.0/users?$skiptoken=page2",
          },
        },
        { status: 200, body: { value: [graphUser({ id: SECOND_USER_ID })] } },
      ];

      const result = await runPull({ readDirectory: true });

      expect(usersCalls()).toHaveLength(2);
      expect(directoryEvents(result.events)).toHaveLength(2);
      expect(storedDirectoryDay(result.cursor)).toBe(today());
    });

    it("refuses a next link that is not Microsoft Graph, and holds the day", async () => {
      usersReplies = [
        {
          status: 200,
          body: {
            value: [graphUser()],
            "@odata.nextLink": "https://evil.test/v1.0/users?$skiptoken=x",
          },
        },
      ];

      const result = await runPull({ readDirectory: true });

      expect(usersCalls()).toHaveLength(1);
      expect(directoryEvents(result.events)).toHaveLength(0);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(storedDirectoryDay(result.cursor)).toBeNull();
      expect(errors.some((line) => line.includes("not Microsoft Graph"))).toBe(
        true,
      );
    });
  });

  describe("when the tenant refuses or garbles the read", () => {
    /** @scenario "A directory read that fails holds the day and delivers the rest" */
    it("names an HTTP 403 for what it is and still delivers the conversations", async () => {
      usersReplies = [{ status: 403, body: {} }];

      const result = await runPull({ readDirectory: true });

      expect(
        warnings.some((line) =>
          line.includes("has not consented to the directory read"),
        ),
      ).toBe(true);
      expect(conversationEvents(result.events)).toHaveLength(1);
      expect(result.errorCount).toBe(0);
      expect(storedDirectoryDay(result.cursor)).toBeNull();
    });

    it("holds a body that is not a page rather than recording an empty tenant", async () => {
      usersReplies = [{ status: 200, body: { error: "oops" } }];

      const result = await runPull({ readDirectory: true });

      expect(directoryEvents(result.events)).toHaveLength(0);
      expect(storedDirectoryDay(result.cursor)).toBeNull();
    });
  });
});
