/**
 * The task as the CLI runs it: dry by default, one option, secrets printed by
 * hint only, one organization's failure reported by code without stopping the
 * rest. Every apply is scoped to this file's tenants; only dry runs see all.
 */

import { nanoid } from "nanoid";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from "vitest";
import { prisma } from "~/server/db";
import type * as encryptionModule from "~/utils/encryption";
import migrateSlackConnections, {
  runSlackConnectionMigration,
} from "../migrateSlackConnections";
import {
  clearSlackMigrationTenant,
  createSlackMigrationTenant,
  findConnections,
  readAutomation,
  removeSlackMigrationTenant,
  type SlackMigrationTenant,
  type StoredAutomation,
  storeBotAutomation,
  storeSlackAutomation,
  storeWebhookAutomation,
} from "./slackMigrationFixtures";

/** A secret whose encryption fails, so one organization's write fails partway. */
const poison = vi.hoisted(() => ({ secret: "" }));

vi.mock("~/utils/encryption", async (importOriginal) => {
  const actual = await importOriginal<typeof encryptionModule>();
  return {
    ...actual,
    encrypt: (text: string) => {
      if (poison.secret && text === poison.secret) {
        const error = new Error(`refusing to store ${text}`);
        error.name = "PoisonedWriteError";
        throw error;
      }
      return actual.encrypt(text);
    },
  };
});

const TOKEN = "xoxb-task-test-token-c3d4";
const WEBHOOK = "https://hooks.slack.com/services/T0/B0/tasktestpath5e6f";
const POISONED_WEBHOOK =
  "https://hooks.slack.com/services/T0/B0/poisonedpath7a8b";
const BROKEN_CIPHERTEXT = "broken:cipher:text0000";

describe("migrateSlackConnections task", () => {
  const ns = nanoid(8).toLowerCase();
  let failing: SlackMigrationTenant | undefined;
  let healthy: SlackMigrationTenant | undefined;
  let log: MockInstance<typeof console.log>;

  const tenants = () => {
    if (!failing || !healthy) throw new Error("tenants not created");
    return { failing, healthy };
  };
  const projectOf = ({
    tenant,
    index,
  }: {
    tenant: SlackMigrationTenant;
    index: number;
  }) => {
    const project = tenant.projects[index];
    if (!project) throw new Error(`no project ${index}`);
    return project.id;
  };
  const printed = () =>
    log.mock.calls.map((call) => call.map(String).join(" ")).join("\n");
  /** `--apply` over this file's tenants only: the database is shared with other suites. */
  const applyToOwnTenants = () => {
    const { failing, healthy } = tenants();
    return runSlackConnectionMigration({
      args: ["--apply"],
      organizationIds: [failing.organization.id, healthy.organization.id],
    });
  };
  const readParams = async (automation: StoredAutomation) =>
    (await readAutomation(automation)).actionParams;

  /** Every secret the healthy tenant's automations hold, as stored and in the clear. */
  const storeHealthyAutomations = async () => {
    const { healthy } = tenants();
    const bot = await storeBotAutomation({
      projectId: projectOf({ tenant: healthy, index: 0 }),
      token: TOKEN,
    });
    const hooks = [
      await storeWebhookAutomation({
        projectId: projectOf({ tenant: healthy, index: 0 }),
        url: WEBHOOK,
      }),
      await storeWebhookAutomation({
        projectId: projectOf({ tenant: healthy, index: 1 }),
        url: WEBHOOK,
      }),
    ];
    const broken = await storeSlackAutomation({
      projectId: projectOf({ tenant: healthy, index: 0 }),
      actionParams: { slackDelivery: "bot", slackBotToken: BROKEN_CIPHERTEXT },
    });
    const storedToken = String(bot.actionParams.slackBotToken);
    return { bot, hooks, broken, secrets: [TOKEN, WEBHOOK, storedToken] };
  };

  /** The secrets, or fragments of one, that reached the output: always none. */
  const printedSecrets = ({ secrets }: { secrets: string[] }) => {
    const output = printed();
    return [
      ...secrets,
      POISONED_WEBHOOK,
      BROKEN_CIPHERTEXT,
      "hooks.slack.com",
      "refusing to store",
    ].filter((secret) => output.includes(secret));
  };

  beforeAll(async () => {
    failing = await createSlackMigrationTenant({
      organizationId: `slackrun-${ns}-a-failing`,
      label: "Failing",
      projectCount: 1,
    });
    healthy = await createSlackMigrationTenant({
      organizationId: `slackrun-${ns}-b-healthy`,
      label: "Healthy",
      projectCount: 2,
    });
  });

  beforeEach(async () => {
    poison.secret = "";
    const { failing, healthy } = tenants();
    await clearSlackMigrationTenant({ tenant: failing });
    await clearSlackMigrationTenant({ tenant: healthy });
    log = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    log.mockRestore();
  });

  afterAll(async () => {
    if (failing) await removeSlackMigrationTenant({ tenant: failing });
    if (healthy) await removeSlackMigrationTenant({ tenant: healthy });
  });

  /** @scenario The migration runs dry unless told to apply, and refuses any other option */
  it("writes nothing without --apply and writes with it", async () => {
    const { healthy } = tenants();
    const { bot, hooks } = await storeHealthyAutomations();
    const organizationId = healthy.organization.id;

    await expect(migrateSlackConnections()).resolves.toBeUndefined();

    expect(log.mock.calls[0]).toEqual([
      "Slack connection migration: dry run, nothing is written. Re-run with --apply to write.",
    ]);
    expect(printed()).toContain(
      `Organization "Slack Migration Healthy" (${organizationId})`,
    );
    expect(printed()).toContain('create  "Slack bot ••••c3d4"');
    expect(await findConnections({ organizationId })).toEqual([]);
    for (const automation of [bot, ...hooks]) {
      expect(await readParams(automation)).toEqual(automation.actionParams);
    }

    log.mockClear();
    await expect(applyToOwnTenants()).resolves.toBeUndefined();

    expect(log.mock.calls[0]).toEqual([
      "Slack connection migration: applying.",
    ]);
    const stored = await findConnections({ organizationId });
    // The bot, and the shared webhook once per project: never widened.
    expect(stored).toHaveLength(3);
    for (const automation of [bot, ...hooks]) {
      expect(await readParams(automation)).toMatchObject({
        slackIntegrationId: expect.any(String),
      });
    }
  });

  /** @scenario The migration runs dry unless told to apply, and refuses any other option */
  it.each([
    [["--dry-run"]],
    [["apply"]],
    [["--apply", "--force"]],
  ])("refuses %j before printing or writing anything", async (args) => {
    const { bot } = await storeHealthyAutomations();
    const unknown = args.filter((arg) => arg !== "--apply").join(" ");

    await expect(migrateSlackConnections(...args)).rejects.toThrow(
      `Unknown argument ${unknown}; the only option is --apply`,
    );

    expect(log).not.toHaveBeenCalled();
    expect(await readParams(bot)).toEqual(bot.actionParams);
  });

  it("leaves out a project whose team row is gone instead of aborting the run", async () => {
    const { healthy } = tenants();
    const orphan = await prisma.project.create({
      data: {
        name: "Orphaned project",
        slug: `--test-project-orphan-${ns}`,
        teamId: `team-gone-${ns}`,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-orphan-${ns}`,
      },
    });
    const orphaned = await storeWebhookAutomation({
      projectId: orphan.id,
      url: WEBHOOK,
    });
    const { bot } = await storeHealthyAutomations();

    try {
      await expect(migrateSlackConnections()).resolves.toBeUndefined();

      expect(printed()).toContain(
        `Organization "Slack Migration Healthy" (${healthy.organization.id})`,
      );
      expect(printed()).not.toContain(orphaned.id);
      expect(await readParams(bot)).toEqual(bot.actionParams);
      expect(await readParams(orphaned)).toEqual(orphaned.actionParams);
      expect(
        await findConnections({ organizationId: healthy.organization.id }),
      ).toEqual([]);
    } finally {
      await prisma.trigger.deleteMany({ where: { projectId: orphan.id } });
      await prisma.project.delete({ where: { id: orphan.id } });
    }
  });

  /** @scenario The migration report never prints a secret */
  it("prints each connection by its hint and never a token, URL or ciphertext", async () => {
    const { secrets } = await storeHealthyAutomations();

    await migrateSlackConnections();
    await applyToOwnTenants();

    expect(printed()).toContain('"Slack bot ••••c3d4"');
    expect(printed()).toContain('"Slack webhook ••••5e6f"');
    expect(printed()).toContain(": cannot decrypt");
    expect(printedSecrets({ secrets })).toEqual([]);
  });

  /** @scenario One organization's failure does not stop the others */
  it("rolls back the failing organization, migrates the next and names the failure by code", async () => {
    const { failing, healthy } = tenants();
    const failingProject = projectOf({ tenant: failing, index: 0 });
    const firstWritten = await storeWebhookAutomation({
      projectId: failingProject,
      url: WEBHOOK,
      createdAt: new Date(Date.now() - 60_000),
    });
    const poisoned = await storeWebhookAutomation({
      projectId: failingProject,
      url: POISONED_WEBHOOK,
    });
    const { bot, hooks, secrets } = await storeHealthyAutomations();
    poison.secret = POISONED_WEBHOOK;

    const failure = await applyToOwnTenants().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(Error);
    const message = failure instanceof Error ? failure.message : "";
    expect(message).toContain(failing.organization.id);
    expect(message).not.toContain(healthy.organization.id);
    expect(
      await findConnections({ organizationId: failing.organization.id }),
    ).toEqual([]);
    for (const automation of [firstWritten, poisoned]) {
      expect(await readParams(automation)).toEqual(automation.actionParams);
    }
    expect(
      await findConnections({ organizationId: healthy.organization.id }),
    ).toHaveLength(3);
    for (const automation of [bot, ...hooks]) {
      expect(await readParams(automation)).toMatchObject({
        slackIntegrationId: expect.any(String),
      });
    }
    const output = printed();
    const failedLine = `Organization "Slack Migration Failing" (${failing.organization.id}) failed, nothing written: PoisonedWriteError`;
    expect(output).toContain(failedLine);
    expect(
      output.indexOf(`Organization "Slack Migration Healthy"`),
    ).toBeGreaterThan(output.indexOf(failedLine));
    expect(printedSecrets({ secrets })).toEqual([]);
  });
});
