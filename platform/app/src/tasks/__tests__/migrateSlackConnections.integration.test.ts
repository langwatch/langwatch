/**
 * One organization's migration against real rows, scoped to its own tenant:
 * one connection per project and secret, legacy fields cleared, rows it must
 * not touch, no second write, and the race with a concurrent run or edit.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  SlackIntegrationKind,
  SlackIntegrationScopeType,
} from "~/generated/prisma/client";
import { slackSecretFingerprint } from "~/server/app-layer/automations/slack-integration/slack-secret-fingerprint";
import { prisma } from "~/server/db";
import { decrypt, encrypt } from "~/utils/encryption";
import { migrateOrganization } from "../migrateSlackConnections";
import {
  addOrganizationAdmin,
  clearSlackMigrationTenant,
  createSlackMigrationTenant,
  findConnections,
  holdTransaction,
  readAutomation,
  removeSlackMigrationTenant,
  type SlackMigrationTenant,
  storeBotAutomation,
  storeSlackAutomation,
  storeSlackConnection,
  storeWebhookAutomation,
  waitForLockWait,
} from "./slackMigrationFixtures";

const TOKEN = "xoxb-migration-test-token-a1b2";
const WEBHOOK = "https://hooks.slack.com/services/T0/B0/migrationtest9z8y";

const linkedParams = z.object({ slackIntegrationId: z.string() });

/** What an automation stores once migrated: its settings less its own secret. */
const withoutSecret = (params: Record<string, unknown>) => {
  const {
    slackWebhook: _webhook,
    slackBotToken: _token,
    slackBotTokenSet: _set,
    ...rest
  } = params;
  return rest;
};

describe("migrateSlackConnections", () => {
  let tenant: SlackMigrationTenant | undefined;

  const current = () => {
    if (!tenant) throw new Error("tenant not created");
    return tenant;
  };
  const organizationId = () => current().organization.id;
  const projectId = (index: number) => {
    const project = current().projects[index];
    if (!project) throw new Error(`no project ${index}`);
    return project.id;
  };
  const projectA = () => projectId(0);
  const projectB = () => projectId(1);

  const run = ({ apply }: { apply: boolean }) =>
    migrateOrganization({
      organizationId: organizationId(),
      projectIds: current().projects.map((project) => project.id),
      apply,
    });
  const connections = () =>
    findConnections({ organizationId: organizationId() });
  const readParams = async (automation: { id: string; projectId: string }) =>
    (await readAutomation(automation)).actionParams;

  beforeAll(async () => {
    tenant = await createSlackMigrationTenant({
      organizationId: `slackmig-${nanoid(8)}`,
      label: "Org",
      projectCount: 2,
    });
  });

  beforeEach(async () => {
    await clearSlackMigrationTenant({ tenant: current() });
  });

  afterAll(async () => {
    if (tenant) await removeSlackMigrationTenant({ tenant });
  });

  /** @scenario Automations sharing a secret share one connection */
  it("stores one project connection per secret and points each automation at its own", async () => {
    const bots = await Promise.all(
      [1, 2, 3].map(() =>
        storeBotAutomation({ projectId: projectA(), token: TOKEN }),
      ),
    );
    const hooks = await Promise.all(
      [1, 2].map(() =>
        storeWebhookAutomation({ projectId: projectA(), url: WEBHOOK }),
      ),
    );

    await run({ apply: true });

    const stored = await connections();
    expect(stored).toHaveLength(2);
    const bot = stored.find((c) => c.kind === SlackIntegrationKind.BOT);
    const hook = stored.find(
      (c) => c.kind === SlackIntegrationKind.INCOMING_WEBHOOK,
    );
    expect(bot).toMatchObject({
      scopeType: SlackIntegrationScopeType.PROJECT,
      scopeId: projectA(),
      name: "Slack bot ••••a1b2",
      secretHint: "a1b2",
      secretFingerprint: slackSecretFingerprint({ secret: TOKEN }),
      webhookUrlEncrypted: null,
      createdById: "system:migration",
    });
    expect(decrypt(bot?.botTokenEncrypted ?? "")).toBe(TOKEN);
    expect(decrypt(hook?.webhookUrlEncrypted ?? "")).toBe(WEBHOOK);
    for (const automation of bots) {
      expect(await readParams(automation)).toEqual({
        ...withoutSecret(automation.actionParams),
        slackIntegrationId: bot?.id,
      });
    }
    for (const automation of hooks) {
      expect(await readParams(automation)).toEqual({
        ...withoutSecret(automation.actionParams),
        slackIntegrationId: hook?.id,
      });
    }
  });

  /** @scenario The migration clears the secret each automation stored */
  it("encrypts the plaintext webhook URL into the connection and keeps every other field on the automation", async () => {
    const legacy = await storeSlackAutomation({
      projectId: projectA(),
      actionParams: {
        slackWebhook: WEBHOOK,
        slackTemplateType: "trace_alert_compact",
        mentions: ["@here"],
        layout: { compact: true, fields: ["name", "score"] },
      },
    });

    await run({ apply: true });

    const [hook, ...rest] = await connections();
    expect(rest).toEqual([]);
    expect(hook).toMatchObject({
      kind: SlackIntegrationKind.INCOMING_WEBHOOK,
      name: "Slack webhook ••••9z8y",
      secretHint: "9z8y",
      secretFingerprint: slackSecretFingerprint({ secret: WEBHOOK }),
      botTokenEncrypted: null,
    });
    expect(hook?.webhookUrlEncrypted).not.toContain("hooks.slack.com");
    expect(decrypt(hook?.webhookUrlEncrypted ?? "")).toBe(WEBHOOK);
    expect(await readParams(legacy)).toEqual({
      ...withoutSecret(legacy.actionParams),
      slackIntegrationId: hook?.id,
    });
  });

  /** @scenario The migration clears the secret each automation stored */
  it("clears the secret an automation an earlier run linked still stores, once", async () => {
    const existing = await storeSlackConnection({
      organizationId: organizationId(),
      kind: SlackIntegrationKind.BOT,
      scopeType: SlackIntegrationScopeType.PROJECT,
      scopeId: projectA(),
      secret: TOKEN,
      name: "Acme HQ",
    });
    const halfDone = await storeSlackAutomation({
      projectId: projectA(),
      actionParams: {
        slackDelivery: "bot",
        slackChannelId: "C0123",
        slackBotToken: encrypt(TOKEN),
        slackBotTokenSet: true,
        slackIntegrationId: existing.id,
      },
    });
    const fresh = await storeWebhookAutomation({
      projectId: projectA(),
      url: WEBHOOK,
    });

    const first = await run({ apply: true });

    expect(first.clearedIds).toEqual([halfDone.id]);
    expect(first.linkedIds).toEqual([fresh.id]);
    expect(await readParams(halfDone)).toEqual({
      slackDelivery: "bot",
      slackChannelId: "C0123",
      slackIntegrationId: existing.id,
    });
    expect(await readParams(fresh)).toEqual({
      slackDelivery: "webhook",
      slackIntegrationId: expect.any(String),
    });
    const afterFirst = await Promise.all(
      [halfDone, fresh].map((a) => readAutomation(a)),
    );

    const second = await run({ apply: true });
    expect(second.clearedIds).toEqual([]);
    expect(second.linkedIds).toEqual([]);
    expect(
      await Promise.all([halfDone, fresh].map((a) => readAutomation(a))),
    ).toEqual(afterFirst);
  });

  /** @scenario A secret shared across projects becomes one connection per project */
  it("stores one project connection in each project for a URL used in both", async () => {
    const first = await storeWebhookAutomation({
      projectId: projectA(),
      url: WEBHOOK,
    });
    const second = await storeWebhookAutomation({
      projectId: projectB(),
      url: WEBHOOK,
    });

    await run({ apply: true });

    const stored = await connections();
    expect(stored.map((c) => [c.scopeType, c.scopeId]).sort()).toEqual(
      [
        [SlackIntegrationScopeType.PROJECT, projectA()],
        [SlackIntegrationScopeType.PROJECT, projectB()],
      ].sort(),
    );
    const inProject = (id: string) => stored.find((c) => c.scopeId === id);
    expect(await readParams(first)).toMatchObject({
      slackIntegrationId: inProject(projectA())?.id,
    });
    expect(await readParams(second)).toMatchObject({
      slackIntegrationId: inProject(projectB())?.id,
    });
  });

  /** @scenario A project's existing connection absorbs matching automations */
  it("links a matching automation and a tokenless bot to the project's existing connection", async () => {
    const existing = await storeSlackConnection({
      organizationId: organizationId(),
      kind: SlackIntegrationKind.BOT,
      scopeType: SlackIntegrationScopeType.PROJECT,
      scopeId: projectA(),
      secret: TOKEN,
      name: "Acme HQ",
    });
    const withToken = await storeBotAutomation({
      projectId: projectA(),
      token: TOKEN,
    });
    const tokenless = await storeBotAutomation({ projectId: projectA() });

    await run({ apply: true });

    expect((await connections()).map((c) => c.id)).toEqual([existing.id]);
    expect(await readParams(withToken)).toMatchObject({
      slackIntegrationId: existing.id,
    });
    expect(await readParams(tokenless)).toMatchObject({
      slackIntegrationId: existing.id,
    });
  });

  /** @scenario Another project's connection is never widened or borrowed */
  it("leaves the project connection as it is and gives the other project its own", async () => {
    const adminId = await addOrganizationAdmin({ tenant: current() });
    const existing = await storeSlackConnection({
      organizationId: organizationId(),
      kind: SlackIntegrationKind.BOT,
      scopeType: SlackIntegrationScopeType.PROJECT,
      scopeId: projectA(),
      secret: TOKEN,
      name: "Acme HQ",
    });
    const home = await storeBotAutomation({
      projectId: projectA(),
      token: TOKEN,
    });
    const elsewhere = await storeBotAutomation({
      projectId: projectB(),
      token: TOKEN,
    });

    await run({ apply: true });

    const stored = await connections();
    expect(stored).toHaveLength(2);
    expect(stored.find((c) => c.id === existing.id)).toEqual(existing);
    const own = stored.find((c) => c.id !== existing.id);
    expect(own).toMatchObject({
      scopeType: SlackIntegrationScopeType.PROJECT,
      scopeId: projectB(),
      createdById: adminId,
    });
    expect(await readParams(home)).toMatchObject({
      slackIntegrationId: existing.id,
    });
    expect(await readParams(elsewhere)).toMatchObject({
      slackIntegrationId: own?.id,
    });
  });

  /** @scenario An organization connection holding the secret is reused as it is */
  it("links automations in two projects to the organization connection without changing it", async () => {
    const existing = await storeSlackConnection({
      organizationId: organizationId(),
      kind: SlackIntegrationKind.INCOMING_WEBHOOK,
      scopeType: SlackIntegrationScopeType.ORGANIZATION,
      scopeId: organizationId(),
      secret: WEBHOOK,
      name: "Company alerts",
    });
    const first = await storeWebhookAutomation({
      projectId: projectA(),
      url: WEBHOOK,
    });
    const second = await storeWebhookAutomation({
      projectId: projectB(),
      url: WEBHOOK,
    });

    await run({ apply: true });

    expect(await connections()).toEqual([existing]);
    expect(await readParams(first)).toMatchObject({
      slackIntegrationId: existing.id,
    });
    expect(await readParams(second)).toMatchObject({
      slackIntegrationId: existing.id,
    });
  });

  it("skips a tokenless bot with no project bot connection, or with two to choose from", async () => {
    for (const { secret, name } of [
      { secret: TOKEN, name: "Workspace one" },
      { secret: "xoxb-second-workspace-5f5f", name: "Workspace two" },
    ]) {
      await storeSlackConnection({
        organizationId: organizationId(),
        kind: SlackIntegrationKind.BOT,
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: projectA(),
        secret,
        name,
      });
    }
    const ambiguous = await storeBotAutomation({ projectId: projectA() });
    const orphaned = await storeBotAutomation({ projectId: projectB() });
    const before = await connections();

    const outcome = await run({ apply: true });

    expect(outcome.linkedIds).toEqual([]);
    expect(
      outcome.skipped.map(({ automation, reason }) => [automation.id, reason]),
    ).toEqual(
      expect.arrayContaining([
        [ambiguous.id, "ambiguous project connection"],
        [orphaned.id, "no secret"],
      ]),
    );
    expect(outcome.skipped).toHaveLength(2);
    expect(await connections()).toEqual(before);
    expect(await readParams(ambiguous)).toEqual(ambiguous.actionParams);
    expect(await readParams(orphaned)).toEqual(orphaned.actionParams);
  });

  /** @scenario Automations the migration must not touch are left unchanged */
  it("leaves deleted automations, archived projects' automations and already-linked automations alone", async () => {
    const deleted = await storeSlackAutomation({
      projectId: projectA(),
      actionParams: { slackDelivery: "webhook", slackWebhook: WEBHOOK },
      deleted: true,
    });
    const linked = await storeSlackAutomation({
      projectId: projectA(),
      actionParams: {
        slackDelivery: "bot",
        slackChannelId: "C0123",
        slackIntegrationId: "conn-chosen-by-a-user",
      },
    });
    const archived = await storeWebhookAutomation({
      projectId: projectB(),
      url: WEBHOOK,
    });
    await prisma.project.update({
      where: { id: projectB() },
      data: { archivedAt: new Date() },
    });
    const untouched = [deleted, linked, archived];
    const before = await Promise.all(untouched.map((a) => readAutomation(a)));

    try {
      const outcome = await run({ apply: true });

      expect(await connections()).toEqual([]);
      expect(outcome.linkedIds).toEqual([]);
      expect(outcome.skipped).toEqual([
        expect.objectContaining({
          automation: expect.objectContaining({ id: archived.id }),
          reason: "archived project",
        }),
      ]);
      expect(
        await Promise.all(untouched.map((a) => readAutomation(a))),
      ).toEqual(before);
    } finally {
      await prisma.project.update({
        where: { id: projectB() },
        data: { archivedAt: null },
      });
    }
  });

  /** @scenario The migration changes nothing unless applied, and nothing twice */
  it("writes nothing on a dry run and nothing on a second apply", async () => {
    const automation = await storeWebhookAutomation({
      projectId: projectA(),
      url: WEBHOOK,
    });

    const dryRun = await run({ apply: false });
    expect(dryRun.linkedIds).toEqual([automation.id]);
    expect(await connections()).toEqual([]);
    expect(await readParams(automation)).toEqual(automation.actionParams);

    const first = await run({ apply: true });
    expect(first.linkedIds).toEqual([automation.id]);
    const afterFirst = await connections();
    const linkedRow = await readAutomation(automation);

    const second = await run({ apply: true });
    expect(second.plan.connections).toEqual([]);
    expect(second.linkedIds).toEqual([]);
    expect(await connections()).toEqual(afterFirst);
    expect(await readAutomation(automation)).toEqual(linkedRow);
  });

  it("keeps inactive automations and leaves an archived project's out of scope", async () => {
    const inactive = await storeWebhookAutomation({
      projectId: projectA(),
      url: WEBHOOK,
    });
    await prisma.trigger.update({
      where: { id: inactive.id, projectId: projectA() },
      data: { active: false },
    });
    const archived = await storeWebhookAutomation({
      projectId: projectB(),
      url: WEBHOOK,
    });
    await prisma.project.update({
      where: { id: projectB() },
      data: { archivedAt: new Date() },
    });

    try {
      const outcome = await run({ apply: true });

      const [only, ...rest] = await connections();
      expect(rest).toEqual([]);
      expect(only).toMatchObject({
        scopeType: SlackIntegrationScopeType.PROJECT,
        scopeId: projectA(),
      });
      expect(outcome.linkedIds).toEqual([inactive.id]);
      expect(outcome.skipped.map((s) => s.reason)).toEqual([
        "archived project",
      ]);
      expect(await readParams(archived)).toEqual(archived.actionParams);
    } finally {
      await prisma.project.update({
        where: { id: projectB() },
        data: { archivedAt: null },
      });
    }
  });

  /** @scenario A secret that cannot be decrypted is skipped, not guessed */
  it("reports an undecryptable token as skipped and leaves the automation unchanged", async () => {
    const broken = await storeSlackAutomation({
      projectId: projectA(),
      actionParams: {
        slackDelivery: "bot",
        slackChannelId: "C0123",
        slackBotToken: "not:real:ciphertext",
      },
    });

    const outcome = await run({ apply: true });

    expect(outcome.skipped).toEqual([
      expect.objectContaining({
        automation: expect.objectContaining({ id: broken.id }),
        reason: "cannot decrypt",
      }),
    ]);
    expect(await connections()).toEqual([]);
    expect(await readParams(broken)).toEqual(broken.actionParams);
  });

  describe("when another writer races the run", () => {
    /** @scenario A concurrent run that stored the secret first is reused, not duplicated */
    it("re-plans after the unique index refuses its insert and links to the row stored first", async () => {
      const automation = await storeBotAutomation({
        projectId: projectA(),
        token: TOKEN,
      });
      const rival = await holdTransaction({
        work: (tx) =>
          tx.slackIntegration.create({
            data: {
              name: "Stored by the other run",
              kind: SlackIntegrationKind.BOT,
              scopeType: SlackIntegrationScopeType.PROJECT,
              scopeId: projectA(),
              organizationId: organizationId(),
              botTokenEncrypted: encrypt(TOKEN),
              secretFingerprint: slackSecretFingerprint({ secret: TOKEN }),
              secretHint: "a1b2",
              createdById: "system:migration",
              updatedById: "system:migration",
            },
          }),
      });

      const migrating = run({ apply: true });
      await waitForLockWait();
      rival.release();
      await rival.committed;
      const outcome = await migrating;

      const [only, ...rest] = await connections();
      expect(rest).toEqual([]);
      expect(only?.name).toBe("Stored by the other run");
      expect(outcome.plan.connections).toEqual([
        expect.objectContaining({ action: "reuse", connectionId: only?.id }),
      ]);
      expect(outcome.linkedIds).toEqual([automation.id]);
      expect(await readParams(automation)).toMatchObject({
        slackIntegrationId: only?.id,
      });
    });

    /** @scenario A concurrent run that stored the secret first is reused, not duplicated */
    it("lets two whole runs race to one connection per secret, each automation linked once", async () => {
      const automations = [
        await storeBotAutomation({ projectId: projectA(), token: TOKEN }),
        await storeBotAutomation({ projectId: projectA(), token: TOKEN }),
        await storeWebhookAutomation({ projectId: projectB(), url: WEBHOOK }),
      ];

      const outcomes = await Promise.all([
        run({ apply: true }),
        run({ apply: true }),
      ]);

      const stored = await connections();
      expect(stored.map((c) => c.kind).sort()).toEqual([
        SlackIntegrationKind.BOT,
        SlackIntegrationKind.INCOMING_WEBHOOK,
      ]);
      expect(outcomes.flatMap((outcome) => outcome.linkedIds).sort()).toEqual(
        automations.map((a) => a.id).sort(),
      );
      for (const automation of automations) {
        const { slackIntegrationId } = linkedParams.parse(
          await readParams(automation),
        );
        expect(stored.map((c) => c.id)).toContain(slackIntegrationId);
      }
    });

    /** @scenario An automation edited while the migration runs is left as edited */
    it("reports an automation edited after planning as changed and keeps the edit", async () => {
      const automation = await storeWebhookAutomation({
        projectId: projectA(),
        url: WEBHOOK,
      });
      const edited = {
        ...automation.actionParams,
        slackWebhook: `${WEBHOOK}-rotated`,
      };
      const editor = await holdTransaction({
        work: (tx) =>
          tx.trigger.update({
            where: { id: automation.id, projectId: projectA() },
            data: { actionParams: edited },
          }),
      });

      const migrating = run({ apply: true });
      await waitForLockWait();
      editor.release();
      await editor.committed;
      const outcome = await migrating;

      expect(outcome.linkedIds).toEqual([]);
      expect(outcome.skipped).toEqual([
        expect.objectContaining({
          automation: expect.objectContaining({ id: automation.id }),
          reason: "changed during migration",
        }),
      ]);
      expect(await readParams(automation)).toEqual(edited);
    });
  });
});
