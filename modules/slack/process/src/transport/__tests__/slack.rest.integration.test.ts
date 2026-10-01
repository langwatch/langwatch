/**
 * @vitest-environment node
 * `GET /api/slack-connections` and its `/api/v1` twin over the real REST
 * runtime and the composed services on memory twins.
 * @see specs/automations/public-api.feature
 */
import { canonicalErrorResponse, createRestRuntime, UnauthorizedError } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import {
  MANAGER,
  ORG,
  OTHER_PROJECT,
  PROJECT,
  composeSlackApi,
} from "../../services/__tests__/slack-connection.fixture.ts";
import { slackRest } from "../slack.rest.ts";

const BOT = "xoxb-1111-secret-abcd";
const WEBHOOK = "https://hooks.slack.com/services/T/B/wxyz";

/** A project API key is its project id here; no key is refused by the runtime. */
async function mount() {
  const slack = composeSlackApi();
  slack.webApi.accept({ token: BOT, identity: { teamId: "T1", teamName: "Acme Slack" } });
  const base = { actorId: MANAGER, projectId: PROJECT } as const;
  await slack.api.createSlackConnection({
    ...base,
    name: "Ops bot",
    kind: "BOT",
    scopeType: "ORGANIZATION",
    scopeId: ORG,
    secret: BOT,
  });
  await slack.api.createSlackConnection({
    ...base,
    name: "Checkout alerts",
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: PROJECT,
    secret: WEBHOOK,
  });
  await slack.api.createSlackConnection({
    ...base,
    projectId: OTHER_PROJECT,
    name: "Search alerts",
    kind: "INCOMING_WEBHOOK",
    scopeType: "PROJECT",
    scopeId: OTHER_PROJECT,
    secret: `${WEBHOOK}2`,
  });
  const hono = createRestRuntime({
    identity: {
      authenticate: ({ request }) => {
        const key = request.headers.get("X-Auth-Token");
        if (!key) throw new UnauthorizedError("No API key");
        return { actor: null, scope: { tier: "project", id: key } };
      },
    },
  }).mount(slackRest.router(), {
    app: () => slack.api,
    credential: "project",
    onError: canonicalErrorResponse,
  });

  return (path: string, key?: string) =>
    hono.fetch(
      new Request(`http://api.test${path}`, { headers: key ? { "X-Auth-Token": key } : {} }),
    );
}

describe("the /api/slack-connections declaration", () => {
  it("lists at GET / behind project:view", () => {
    const routes = slackRest.router().routes;

    expect(
      routes.map((route) => ({
        method: route.method,
        path: route.path,
        operation: route.operation,
        permission: route.permission,
      })),
    ).toEqual([
      {
        method: "get",
        path: "/",
        operation: "getApiSlackConnections",
        permission: "project:view",
      },
    ]);
  });
});

describe.each(["/api/slack-connections", "/api/v1/slack-connections"])("GET %s", (path) => {
  describe("given organization, project and other-project connections", () => {
    /** @scenario "A project lists the Slack connections it can deliver through" */
    it("lists the organization's and the project's connections by name", async () => {
      const get = await mount();

      const response = await get(path, PROJECT);

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual([
        {
          id: expect.any(String),
          name: "Checkout alerts",
          kind: "webhook",
          scopeType: "PROJECT",
          scopeId: PROJECT,
          scopeName: "Alpha",
          slackTeamName: null,
          createdAt: expect.any(String),
        },
        {
          id: expect.any(String),
          name: "Ops bot",
          kind: "bot",
          scopeType: "ORGANIZATION",
          scopeId: ORG,
          scopeName: "Acme",
          slackTeamName: "Acme Slack",
          createdAt: expect.any(String),
        },
      ]);
    });

    /** @scenario "A listed Slack connection never carries its secret" */
    it("returns no secret material", async () => {
      const get = await mount();

      const body = await (await get(path, PROJECT)).text();

      for (const secret of [
        BOT,
        WEBHOOK,
        "hooks.slack.com",
        "Encrypted",
        "secretHint",
        "fingerprint",
      ]) {
        expect(body).not.toContain(secret);
      }
    });

    /** @scenario "Another project's Slack connections are not listed" */
    it("leaves out another project's connection", async () => {
      const get = await mount();

      const body = await (await get(path, PROJECT)).text();

      expect(body).not.toContain("Search alerts");
    });
  });

  describe("given no API key", () => {
    /** @scenario "Listing Slack connections without an API key is refused" */
    it("answers 401 and lists nothing", async () => {
      const get = await mount();

      const response = await get(path);

      expect(response.status).toBe(401);
      expect(await response.text()).not.toContain("Ops bot");
    });
  });
});
