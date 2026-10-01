/** One organization's Slack connection pass. @see specs/automations/slack-connections.feature */
import { SystemMigrationRunnerService, type TenantSource } from "@langwatch/system-migrations";
import { describe, expect, it } from "vitest";

import {
  BOT_TOKEN,
  fixtureCrypto,
  MemoryMigrationState,
  ORGANIZATION_ID,
  OTHER_PROJECT_ID,
  PROJECT_ID,
  SECOND_ORGANIZATION_ID,
  SECOND_PROJECT_ID,
  slackMigrationWorld,
  soleProcessLease,
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

  describe("given a project whose Slack integration was set up before this change", () => {
    const existing = {
      id: "conn-existing",
      name: "Existing bot",
      kind: "BOT",
      projectId: PROJECT_ID,
      secret: BOT_TOKEN,
    } as const;

    /** @scenario "A project's existing connection absorbs matching automations" */
    it("points a same-token automation and a tokenless bot automation at it, creating no second", async () => {
      const world = slackMigrationWorld();
      world.slack.addConnection(existing);
      await world.addAutomation({
        id: "with-token",
        actionParams: {
          slackDelivery: "bot",
          slackBotToken: fixtureCrypto.encrypt(BOT_TOKEN),
          slackChannelId: "C1",
        },
      });
      await world.addAutomation({
        id: "tokenless",
        actionParams: { slackDelivery: "bot", slackChannelId: "C2" },
      });

      await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      for (const triggerId of ["with-token", "tokenless"]) {
        const row = await world.triggers.findByIdOrThrow({ triggerId, projectId: PROJECT_ID });
        expect(row.actionParams).toMatchObject({ slackIntegrationId: "conn-existing" });
      }
      expect(world.slack.connections).toEqual([existing]);
    });

    /** @scenario "Another project's connection is never widened or borrowed" */
    it("gives another project's same-token automation a connection of its own project", async () => {
      const world = slackMigrationWorld();
      world.slack.addConnection(existing);
      await world.addAutomation({
        id: "elsewhere",
        projectId: OTHER_PROJECT_ID,
        actionParams: {
          slackDelivery: "bot",
          slackBotToken: fixtureCrypto.encrypt(BOT_TOKEN),
          slackChannelId: "C1",
        },
      });

      await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      const row = await world.triggers.findByIdOrThrow({
        triggerId: "elsewhere",
        projectId: OTHER_PROJECT_ID,
      });
      const created = world.slack.connections.filter(({ id }) => id !== existing.id);
      expect(created).toHaveLength(1);
      expect(created[0]).toMatchObject({ projectId: OTHER_PROJECT_ID, secret: BOT_TOKEN });
      expect(row.actionParams).toMatchObject({ slackIntegrationId: created[0]?.id });
      expect(world.slack.connections).toContainEqual(existing);
    });
  });

  describe("given an organization connection holding a webhook URL", () => {
    /** @scenario "An organization connection holding the secret is reused as it is" */
    it("links automations in two projects to it and creates no other", async () => {
      const world = slackMigrationWorld();
      const shared = {
        id: "conn-org",
        name: "Everyone",
        kind: "INCOMING_WEBHOOK",
        projectId: PROJECT_ID,
        secret: WEBHOOK_URL,
        organizationWide: true,
      } as const;
      world.slack.addConnection(shared);
      await world.addAutomation({ id: "a", actionParams: { slackWebhook: WEBHOOK_URL } });
      await world.addAutomation({
        id: "b",
        projectId: OTHER_PROJECT_ID,
        actionParams: { slackWebhook: WEBHOOK_URL },
      });

      await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      for (const [triggerId, projectId] of [
        ["a", PROJECT_ID],
        ["b", OTHER_PROJECT_ID],
      ] as const) {
        const row = await world.triggers.findByIdOrThrow({ triggerId, projectId });
        expect(row.actionParams).toMatchObject({ slackIntegrationId: "conn-org" });
      }
      expect(world.slack.connections).toEqual([shared]);
    });
  });

  describe("given rows the migration must not touch", () => {
    /** @scenario "Automations the migration must not touch are left unchanged" */
    it("leaves a deleted automation, an archived project's and one already on a bare connection", async () => {
      const world = slackMigrationWorld({ archivedProjectIds: [OTHER_PROJECT_ID] });
      await world.addAutomation({ id: "gone", actionParams: { slackWebhook: WEBHOOK_URL } });
      await world.triggers.update({ id: "gone", projectId: PROJECT_ID, deleted: true });
      await world.addAutomation({
        id: "archived",
        projectId: OTHER_PROJECT_ID,
        actionParams: { slackWebhook: WEBHOOK_URL },
      });
      await world.addAutomation({
        id: "bare",
        actionParams: { slackIntegrationId: "conn-1", slackDelivery: "webhook" },
      });
      const before = {
        gone: await world.triggers.findByIdOrThrow({ triggerId: "gone", projectId: PROJECT_ID }),
        archived: await world.triggers.findByIdOrThrow({
          triggerId: "archived",
          projectId: OTHER_PROJECT_ID,
        }),
        bare: await world.triggers.findByIdOrThrow({ triggerId: "bare", projectId: PROJECT_ID }),
      };

      await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      expect(
        await world.triggers.findByIdOrThrow({ triggerId: "gone", projectId: PROJECT_ID }),
      ).toEqual(before.gone);
      expect(
        await world.triggers.findByIdOrThrow({
          triggerId: "archived",
          projectId: OTHER_PROJECT_ID,
        }),
      ).toEqual(before.archived);
      expect(
        await world.triggers.findByIdOrThrow({ triggerId: "bare", projectId: PROJECT_ID }),
      ).toEqual(before.bare);
      expect(world.slack.connections).toEqual([]);
    });
  });

  describe("given another run stores the secret after this one planned", () => {
    /** @scenario "A concurrent run that stored the secret first is reused, not duplicated" */
    it("links the automation to the stored connection and creates no second", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({ id: "hook", actionParams: { slackWebhook: WEBHOOK_URL } });
      world.slack.beforeStore = async () =>
        world.slack.addConnection({
          id: "conn-rival",
          name: "Stored by the rival run",
          kind: "INCOMING_WEBHOOK",
          projectId: PROJECT_ID,
          secret: WEBHOOK_URL,
        });

      await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      const row = await world.triggers.findByIdOrThrow({
        triggerId: "hook",
        projectId: PROJECT_ID,
      });
      expect(row.actionParams).toMatchObject({ slackIntegrationId: "conn-rival" });
      expect(world.slack.connections.map(({ id }) => id)).toEqual(["conn-rival"]);
    });
  });

  describe("given an automation edited after the pass planned it", () => {
    /** @scenario "An automation edited while the migration runs is left as edited" */
    it("keeps the edit, does not link it and reports it as changed during migration", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({ id: "hook", actionParams: { slackWebhook: WEBHOOK_URL } });
      const edited = { slackWebhook: `${WEBHOOK_URL}-edited`, slackDelivery: "webhook" };
      world.slack.beforeStore = async () => {
        await world.triggers.update({ id: "hook", projectId: PROJECT_ID, actionParams: edited });
      };

      const outcome = await world.migration.migrateTenant({ tenantId: ORGANIZATION_ID });

      const row = await world.triggers.findByIdOrThrow({
        triggerId: "hook",
        projectId: PROJECT_ID,
      });
      expect(row.actionParams).toEqual(edited);
      expect(outcome).toMatchObject({
        report: { linked: 0, skippedReasons: { "changed during migration": 1 } },
      });
    });
  });

  describe("given two organizations and one whose connection store fails partway", () => {
    /** @scenario "One organization's failure does not stop the others" */
    it("parks that organization, migrates the other, and a retry reuses what was stored", async () => {
      const world = slackMigrationWorld();
      await world.addAutomation({ id: "first-a", actionParams: { slackWebhook: WEBHOOK_URL } });
      await world.addAutomation({
        id: "first-b",
        actionParams: { slackWebhook: `${WEBHOOK_URL}-b` },
      });
      await world.addAutomation({
        id: "second",
        projectId: SECOND_PROJECT_ID,
        actionParams: { slackWebhook: `${WEBHOOK_URL}-second` },
      });
      world.slack.failStore = { organizationId: ORGANIZATION_ID, afterStored: 1 };
      const organizations = [ORGANIZATION_ID, SECOND_ORGANIZATION_ID];
      const tenants: TenantSource = {
        findTenantIdsAfter: async ({ cursor }) => (cursor === null ? organizations : []),
      };
      const state = new MemoryMigrationState();
      const runner = new SystemMigrationRunnerService({
        state,
        lease: soleProcessLease,
        tenants,
        cohort: () => true,
        migrations: [world.migration],
      });
      const statusOf = async (tenantId: string) =>
        (await state.getRecord({ migrationName: world.migration.name, tenantId })).status;
      const secretsStored = () => world.slack.connections.map(({ secret }) => secret).toSorted();

      await runner.runPass();

      expect(await statusOf(ORGANIZATION_ID)).toBe("parked");
      expect(await statusOf(SECOND_ORGANIZATION_ID)).toBe("migrated");
      const storedBeforeRetry = world.slack.connections.map(({ id }) => id);
      expect(storedBeforeRetry).toHaveLength(2);

      await runner.runPass();
      await runner.runPass();

      expect(await statusOf(ORGANIZATION_ID)).toBe("finalized");
      expect(await statusOf(SECOND_ORGANIZATION_ID)).toBe("finalized");
      expect(secretsStored()).toEqual(
        [WEBHOOK_URL, `${WEBHOOK_URL}-b`, `${WEBHOOK_URL}-second`].toSorted(),
      );
      expect(world.slack.connections.map(({ id }) => id)).toEqual(
        expect.arrayContaining(storedBeforeRetry),
      );
      for (const triggerId of ["first-a", "first-b"]) {
        const row = await world.triggers.findByIdOrThrow({ triggerId, projectId: PROJECT_ID });
        expect(row.actionParams).toEqual({ slackIntegrationId: expect.any(String) });
      }
    });
  });
});
