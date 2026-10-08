import type { Context, Next } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SlackIntegration } from "~/generated/prisma/client";
import { FakeSlackIntegrationRepository } from "~/server/app-layer/automations/slack-integration/__tests__/fakeSlackIntegrationRepository";
import { SlackIntegrationService } from "~/server/app-layer/automations/slack-integration/slack-integration.service";

const repo = new FakeSlackIntegrationRepository();

vi.mock("~/server/db", () => ({ prisma: {} }));
vi.mock(
  "~/server/app-layer/automations/slack-integration/slack-integration.wiring",
  () => ({
    createSlackIntegrationService: () => new SlackIntegrationService(repo),
  }),
);

// A token names a fake project; no token falls through to the real middleware.
vi.mock("~/app/api/middleware/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("~/app/api/middleware/auth")>();
  return {
    ...actual,
    authMiddleware: async (c: Context, next: Next) => {
      const token = c.req.header("X-Auth-Token");
      if (!token) return actual.authMiddleware(c, next);
      c.set("project", { id: token, slug: token, apiKey: token });
      await next();
    },
    requirePermission: () => async (_c: unknown, next: () => Promise<void>) =>
      next(),
  };
});

const { app } = await import("../[[...route]]/app");

const BOT_TOKEN = ["xoxb", "fake", "bot", "token"].join("-");
const WEBHOOK_URL = `https://hooks.slack.com/services/${"FAKE"}/webhook`;

const row = (fields: Partial<SlackIntegration>): SlackIntegration => ({
  id: "conn",
  name: "Connection",
  kind: "INCOMING_WEBHOOK",
  scopeType: "PROJECT",
  scopeId: "project-1",
  organizationId: "org-1",
  botTokenEncrypted: null,
  webhookUrlEncrypted: null,
  secretFingerprint: "fingerprint-secret",
  secretHint: "hint",
  slackTeamId: null,
  slackTeamName: null,
  createdById: "user-1",
  updatedById: "user-1",
  createdAt: new Date("2026-09-01T00:00:00.000Z"),
  updatedAt: new Date("2026-09-02T00:00:00.000Z"),
  ...fields,
});

const list = (token?: string) =>
  app.request("/api/slack-connections", {
    headers: token ? { "X-Auth-Token": token } : {},
  });

describe("GET /api/slack-connections", () => {
  beforeEach(() => {
    repo.rows.clear();
    for (const connection of [
      row({
        id: "conn-bot",
        name: "Alerts bot",
        kind: "BOT",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        botTokenEncrypted: BOT_TOKEN,
        slackTeamId: "T-ACME",
        slackTeamName: "Acme Workspace",
      }),
      row({
        id: "conn-hook",
        name: "Checkout alerts",
        webhookUrlEncrypted: WEBHOOK_URL,
      }),
      row({
        id: "conn-other",
        name: "Search alerts",
        scopeId: "project-2",
        webhookUrlEncrypted: WEBHOOK_URL,
      }),
    ]) {
      repo.rows.set(connection.id, connection);
    }
  });

  /** @scenario "A project lists the Slack connections it can deliver through" */
  it("lists the organization's and the project's connections by name", async () => {
    const response = await list("project-1");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([
      {
        id: "conn-bot",
        name: "Alerts bot",
        kind: "bot",
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        scopeName: "Acme",
        slackTeamName: "Acme Workspace",
        createdAt: "2026-09-01T00:00:00.000Z",
      },
      {
        id: "conn-hook",
        name: "Checkout alerts",
        kind: "webhook",
        scopeType: "PROJECT",
        scopeId: "project-1",
        scopeName: "Checkout",
        slackTeamName: null,
        createdAt: "2026-09-01T00:00:00.000Z",
      },
    ]);
  });

  /** @scenario "A listed Slack connection never carries its secret" */
  it("returns no secret material", async () => {
    const body = await (await list("project-1")).text();

    for (const secret of [
      BOT_TOKEN,
      WEBHOOK_URL,
      "hooks.slack.com",
      "fingerprint-secret",
      "Encrypted",
      "secretHint",
    ]) {
      expect(body).not.toContain(secret);
    }
  });

  /** @scenario "Another project's Slack connections are not listed" */
  it("leaves out another project's connection", async () => {
    const body = await (await list("project-1")).json();

    expect(body).toHaveLength(2);
    expect(body).not.toContainEqual(
      expect.objectContaining({ id: "conn-other" }),
    );
  });

  /** @scenario "Listing Slack connections without an API key is refused" */
  it("answers 401 without an API key", async () => {
    const response = await list();

    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("Alerts bot");
  });
});
