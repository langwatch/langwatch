/** One organization's Slack connection pass. @see specs/automations/slack-connections.feature */
import { describe, expect, it } from "vitest";

import {
  BOT_TOKEN,
  fixtureCrypto,
  ORGANIZATION_ID,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  slackMigrationWorld,
  WEBHOOK_URL,
} from "./legacy-import.slack-connection.migration.fixture.ts";

describe("SlackConnectionMigration", () => {
  /** @scenario "The migration runs by itself, on cloud and self-hosted" */
  it("is registered under the stable name ops keys its state by", () => {
    const { migration } = slackMigrationWorld();

    expect(migration).toMatchObject({
      name: "automations-slack-connections",
      title: "Slack connections",
      requiresOperatorConfirmation: false,
      runsAutomaticallyOnSelfHosted: true,
      enrolledAutomatically: true,
    });
  });

  describe("given automations storing their own webhook and bot token", () => {
    /** @scenario "A pass that moved anything runs again, and a pass with nothing left finishes" */
    it("moves each secret onto a connection, reports migrated, then finalizes", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({
        id: "hook-1",
        actionParams: { slackDelivery: "webhook", slackWebhook: WEBHOOK_URL },
      });
      await world.addAutomation({ id: "hook-2", actionParams: { slackWebhook: WEBHOOK_URL } });
      await world.addAutomation({
        id: "bot-1",
        actionParams: {
          slackDelivery: "bot",
          slackBotToken: fixtureCrypto.encrypt(BOT_TOKEN),
          slackChannelId: "C1",
        },
      });

      const first = await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });
      const second = await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      expect(first).toMatchObject({
        status: "migrated",
        report: { linked: 3, cleared: 0, skipped: 0 },
      });
      expect(second).toMatchObject({ status: "finalized", report: { linked: 0, cleared: 0 } });
      expect(world.slack.connections.map((connection) => connection.kind).toSorted()).toEqual([
        "BOT",
        "INCOMING_WEBHOOK",
      ]);
      const hook = await world.triggers.findByIdOrThrow({
        triggerId: "hook-1",
        projectId: PROJECT_ID,
      });
      const bot = await world.triggers.findByIdOrThrow({
        triggerId: "bot-1",
        projectId: PROJECT_ID,
      });
      expect(hook.actionParams).toEqual({
        slackDelivery: "webhook",
        slackIntegrationId: expect.any(String),
      });
      expect(bot.actionParams).toEqual({
        slackDelivery: "bot",
        slackChannelId: "C1",
        slackIntegrationId: expect.any(String),
      });
      expect(JSON.stringify(first)).not.toContain(WEBHOOK_URL);
    });
  });

  describe("given the same webhook in two projects", () => {
    it("stores one connection per project", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({ id: "a", actionParams: { slackWebhook: WEBHOOK_URL } });
      await world.addAutomation({
        id: "b",
        projectId: OTHER_PROJECT_ID,
        actionParams: { slackWebhook: WEBHOOK_URL },
      });

      await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      expect(world.slack.connections.map((connection) => connection.projectId).toSorted()).toEqual(
        [OTHER_PROJECT_ID, PROJECT_ID].toSorted(),
      );
    });
  });

  describe("given an automation already on a connection that still stores a secret", () => {
    /** @scenario "The migration clears the secret each automation stored" */
    it("clears the secret and keeps the connection", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({
        id: "c",
        actionParams: { slackIntegrationId: "conn-kept", slackWebhook: WEBHOOK_URL },
      });

      const outcome = await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      expect(outcome).toMatchObject({ status: "migrated", report: { linked: 0, cleared: 1 } });
      const row = await world.triggers.findByIdOrThrow({ triggerId: "c", projectId: PROJECT_ID });
      expect(row.actionParams).toEqual({ slackIntegrationId: "conn-kept" });
    });
  });

  describe("given Slack automations on connections", () => {
    /** @scenario "The migration claims the connection of every Slack automation" */
    it("claims every active one's connection, and claims alone finalize", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({
        id: "on",
        actionParams: { slackIntegrationId: "conn-1", slackDelivery: "webhook" },
      });
      await world.addAutomation({
        id: "paused",
        active: false,
        actionParams: { slackIntegrationId: "conn-2", slackDelivery: "webhook" },
      });

      const outcome = await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      expect(outcome).toMatchObject({ status: "finalized", report: { claimed: 1 } });
      expect([...(world.slack.claims.get("conn-1") ?? [])]).toEqual(["on"]);
      expect(world.slack.claims.get("conn-2")).toBeUndefined();
    });
  });

  describe("given rows the pass cannot move", () => {
    it("skips an undecryptable token and an archived project's automation, and reports why", async () => {
      const world = slackMigrationWorld({ archivedProjectIds: [OTHER_PROJECT_ID] });
      await world.addAutomation({
        id: "bad",
        actionParams: { slackDelivery: "bot", slackBotToken: "not-ours" },
      });
      await world.addAutomation({
        id: "old",
        projectId: OTHER_PROJECT_ID,
        actionParams: { slackWebhook: WEBHOOK_URL },
      });

      const outcome = await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      expect(outcome).toMatchObject({
        status: "finalized",
        report: { skipped: 2, skippedReasons: { "cannot decrypt": 1, "archived project": 1 } },
      });
      expect(world.slack.connections).toEqual([]);
    });
  });

  describe("given an aborted pass", () => {
    /** @scenario "A pass aborted at shutdown writes nothing" */
    it("stops before it writes anything", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({ id: "hook", actionParams: { slackWebhook: WEBHOOK_URL } });
      const signal = AbortSignal.abort();

      await expect(
        world.migration.migrateTenant({ tenantId: ORGANIZATION_ID, signal }),
      ).rejects.toMatchObject({
        name: "AbortError",
      });
      expect(world.slack.connections).toEqual([]);
    });
  });
});
