/**
 * The public API expresses the automations the dashboard expresses, and the
 * rows it writes are the rows the dashboard reads back. These run against the
 * real route, the real service and the real database: the parity being
 * asserted is about what reaches storage and what the other surface then makes
 * of it, which a mocked service could not answer.
 *
 * The one thing that is not real is the send. A test fire is observed at the
 * dispatch seam rather than delivered, so the assertion is about the
 * destination the API resolved from the saved row — the part this surface owns.
 */
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
} from "@prisma/client";
import { nanoid } from "nanoid";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { extractGraphAlertFromTriggerRow } from "~/server/app-layer/automations/graph-alert.builder";
import { decryptWebhookHeaders } from "~/server/app-layer/automations/providers/webhook/server";
import { PrismaTriggerRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { redactTriggerForRead } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";

const testFire = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({
    triggers: new TriggerService(new PrismaTriggerRepository(prisma)),
    triggerTemplates: { testFire },
    projects: {
      getById: async (projectId: string) =>
        prisma.project.findUnique({ where: { id: projectId } }),
    },
  }),
}));

import { app } from "../[[...route]]/app";

const CONDITION = { "metadata.labels": ["prod"] };
const WEBHOOK_URL = "https://example.com/hooks/langwatch";
const RETARGETED_URL = "https://example.com/hooks/langwatch-v2";
const HEADER_VALUE = "Bearer swordfish-1";
const RETARGETED_HEADER_VALUE = "Bearer swordfish-2";
const REDACTED = "[redacted]";

describe("Feature: automations over the public API express what the dashboard expresses", () => {
  const ns = `triggers-parity-${nanoid(8)}`;

  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;
  let otherProject: Project | undefined;

  const projectId = () => project!.id;

  const headers = () => ({
    "X-Auth-Token": project!.apiKey,
    "Content-Type": "application/json",
  });

  const post = (path: string, body?: Record<string, unknown>) =>
    app.request(path, {
      method: "POST",
      headers: headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const patch = (path: string, body: Record<string, unknown>) =>
    app.request(path, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify(body),
    });

  const createTrigger = (body: Record<string, unknown>) =>
    post("/api/triggers", body);

  /** A fixture, so a failure to build it is a broken test rather than a
   *  failed expectation about the behaviour under test. */
  const created = async (response: Response) => {
    if (response.status !== 201) {
      throw new Error(
        `fixture automation was not created: ${response.status} ${await response.text()}`,
      );
    }
    return (await response.json()) as { id: string };
  };

  const emailAutomation = async (name: string, extra = {}) =>
    created(
      await createTrigger({
        name,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["someone@example.com"] },
        filters: CONDITION,
        ...extra,
      }),
    );

  const withWebhookChannel = async <T>(
    on: boolean,
    run: () => Promise<T>,
  ): Promise<T> => {
    const previous = process.env.FEATURE_FLAG_FORCE_ENABLE;
    if (on)
      process.env.FEATURE_FLAG_FORCE_ENABLE = "release_webhook_automations";
    else delete process.env.FEATURE_FLAG_FORCE_ENABLE;
    try {
      return await run();
    } finally {
      if (previous === undefined) delete process.env.FEATURE_FLAG_FORCE_ENABLE;
      else process.env.FEATURE_FLAG_FORCE_ENABLE = previous;
    }
  };

  const webhookAutomation = async (name: string) =>
    withWebhookChannel(true, async () =>
      created(
        await createTrigger({
          name,
          action: TriggerAction.SEND_WEBHOOK,
          actionParams: {
            url: WEBHOOK_URL,
            headers: { Authorization: HEADER_VALUE },
          },
          filters: CONDITION,
        }),
      ),
    );

  const storedRow = (id: string) =>
    prisma.trigger.findUniqueOrThrow({
      where: { id, projectId: projectId() },
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Triggers Parity Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Triggers Parity Team",
        slug: `--test-team-${ns}`,
        organizationId: organization!.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Triggers Parity Project",
        slug: `--test-project-${ns}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
    otherProject = await prisma.project.create({
      data: {
        name: "Someone Else's Project",
        slug: `--test-other-project-${ns}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-other-api-key-${ns}`,
      },
    });
  });

  beforeEach(() => {
    testFire.mockReset();
    testFire.mockResolvedValue({
      channel: "email",
      recipientCount: 1,
      usedDefault: true,
      missingVariables: [],
      errors: [],
    });
  });

  afterAll(async () => {
    for (const p of [project, otherProject]) {
      if (!p) continue;
      await prisma.triggerSent.deleteMany({ where: { projectId: p.id } });
      await prisma.trigger.deleteMany({ where: { projectId: p.id } });
      await prisma.customGraph.deleteMany({ where: { projectId: p.id } });
      await prisma.dataset.deleteMany({ where: { projectId: p.id } });
      await prisma.project.delete({ where: { id: p.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  describe("when an alert on a graph is created over the API", () => {
    /** @scenario "A graph alert created via the API renders in the UI" */
    it("stores the row the dashboard hydrates its alert from", async () => {
      const graph = await prisma.customGraph.create({
        data: {
          projectId: projectId(),
          name: `Errors per minute ${ns}`,
          graph: {},
        },
      });

      const response = await createTrigger({
        name: `Errors are climbing ${ns}`,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["oncall@example.com"] },
        alertType: "CRITICAL",
        customGraphId: graph.id,
        graphAlert: {
          seriesName: "errors",
          operator: "gt",
          threshold: 10,
          timePeriod: 15,
        },
      });

      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: string; kind: string };
      expect(created.kind).toBe("ALERT");

      // What the dashboard reads: the same row, through the read the drawer
      // uses, parsed by the parser the drawer hydrates its form from.
      const forTheDashboard = redactTriggerForRead(await storedRow(created.id));
      expect(forTheDashboard).toMatchObject({
        customGraphId: graph.id,
        alertType: "CRITICAL",
        triggerKind: "ALERT",
        notificationCadence: "immediate",
      });
      expect(
        extractGraphAlertFromTriggerRow(forTheDashboard.actionParams),
      ).toMatchObject({
        seriesName: "errors",
        operator: "gt",
        threshold: 10,
        timePeriod: 15,
      });
    });

    /** @scenario "An alert on a graph from another project is refused" */
    it("refuses an alert on a graph this project does not have", async () => {
      const foreign = await prisma.customGraph.create({
        data: {
          projectId: otherProject!.id,
          name: `Not yours ${ns}`,
          graph: {},
        },
      });

      const response = await createTrigger({
        name: `Foreign graph ${ns}`,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["oncall@example.com"] },
        alertType: "WARNING",
        customGraphId: foreign.id,
        graphAlert: {
          seriesName: "errors",
          operator: "gt",
          threshold: 1,
          timePeriod: 5,
        },
      });

      expect(response.status).toBe(404);
      expect((await response.json()).error).toBe("graph_not_found");
    });
  });

  describe("when an automation states templates, cadence and a trace query", () => {
    /** @scenario "The upsert shape is expressible over the API" */
    it("saves each of them onto the row", async () => {
      const created = await emailAutomation(`Full shape ${ns}`, {
        filters: {},
        filterQuery: "status:error",
        templates: {
          emailSubjectTemplate: "{{ trigger.name }} fired",
          emailBodyTemplate: "It fired.",
        },
        notificationCadence: "hourly_digest",
        traceDebounceMs: 60_000,
      });

      expect(await storedRow(created.id)).toMatchObject({
        filterQuery: "status:error",
        emailSubjectTemplate: "{{ trigger.name }} fired",
        emailBodyTemplate: "It fired.",
        notificationCadence: "hourly_digest",
        traceDebounceMs: 60_000,
      });
    });

    /** @scenario "A trace query the platform cannot read is refused" */
    it("refuses a query it cannot read", async () => {
      const response = await createTrigger({
        name: `Bad query ${ns}`,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["someone@example.com"] },
        filterQuery: "status:(error",
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe(
        "trigger_filter_query_invalid",
      );
    });
  });

  describe("when an automation is test-fired over the API", () => {
    /** @scenario "API test-fire delivers to the automation's own destination" */
    it("sends to the destination the automation is saved with", async () => {
      const created = await emailAutomation(`Test fire ${ns}`);

      const response = await post(`/api/triggers/${created.id}/test-fire`);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        channel: "email",
        recipientCount: 1,
      });
      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "email",
          recipients: ["someone@example.com"],
        }),
      );
    });

    /** @scenario "A test fire with nothing to deliver to says so" */
    it("declines when the automation writes a record rather than sending", async () => {
      const dataset = await prisma.dataset.create({
        data: {
          projectId: projectId(),
          name: `Matched traces ${ns}`,
          slug: `matched-traces-${ns}`,
          columnTypes: [],
        },
      });
      const created = (await (
        await createTrigger({
          name: `Dataset rows ${ns}`,
          action: TriggerAction.ADD_TO_DATASET,
          actionParams: {
            datasetId: dataset.id,
            datasetMapping: { mapping: { input: { source: "trace" } } },
          },
          filters: CONDITION,
        })
      ).json()) as { id: string };

      const response = await post(`/api/triggers/${created.id}/test-fire`);

      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe("test_fire_unavailable");
      expect(testFire).not.toHaveBeenCalled();
    });
  });

  describe("when an automation's fires are read over the API", () => {
    /** @scenario "Fire history is readable over the API" */
    it("answers with what it has done, newest first", async () => {
      const created = await emailAutomation(`Has fired ${ns}`);
      const older = new Date(Date.now() - 60_000);
      await prisma.triggerSent.createMany({
        data: [
          {
            triggerId: created.id,
            projectId: projectId(),
            traceId: `trace-older-${ns}`,
            createdAt: older,
          },
          {
            triggerId: created.id,
            projectId: projectId(),
            traceId: `trace-newer-${ns}`,
          },
        ],
      });

      const response = await app.request(
        `/api/triggers/${created.id}/fires?limit=10`,
        { headers: headers() },
      );

      expect(response.status).toBe(200);
      const fires = (await response.json()) as { firedAt: string }[];
      expect(fires).toHaveLength(2);
      expect(new Date(fires[0]!.firedAt).getTime()).toBeGreaterThan(
        new Date(fires[1]!.firedAt).getTime(),
      );
    });
  });

  describe("when an automation is paused and resumed over the API", () => {
    /** @scenario "Pausing and resuming round-trips over the API" */
    it("answers with the state it is in each time", async () => {
      const created = await emailAutomation(`Pause me ${ns}`);

      const paused = await post(`/api/triggers/${created.id}/disable`);
      expect(paused.status).toBe(200);
      expect(await paused.json()).toMatchObject({ active: false });

      const resumed = await post(`/api/triggers/${created.id}/enable`);
      expect(resumed.status).toBe(200);
      expect(await resumed.json()).toMatchObject({ active: true });
      expect(await storedRow(created.id)).toMatchObject({
        active: true,
        pausedReason: null,
      });
    });
  });

  describe("when a webhook automation is pointed at a new destination", () => {
    /** @scenario "Retargeting and re-stating the header values succeeds in one call" */
    it("saves the new destination and the values sent with it", async () => {
      const created = await webhookAutomation(`Retarget ${ns}`);

      const response = await withWebhookChannel(true, () =>
        patch(`/api/triggers/${created.id}`, {
          actionParams: {
            url: RETARGETED_URL,
            headers: { Authorization: RETARGETED_HEADER_VALUE },
          },
        }),
      );

      expect(response.status).toBe(200);
      const stored = await storedRow(created.id);
      expect(stored.actionParams).toMatchObject({ url: RETARGETED_URL });
      expect(decryptWebhookHeaders(stored.actionParams as never)).toEqual({
        Authorization: RETARGETED_HEADER_VALUE,
      });
    });

    /** @scenario "Retargeting while keeping the stored header values is refused" */
    it("says the values have to travel with the new destination", async () => {
      const created = await webhookAutomation(`Retarget kept ${ns}`);

      const response = await withWebhookChannel(true, () =>
        patch(`/api/triggers/${created.id}`, {
          actionParams: {
            url: RETARGETED_URL,
            headers: { Authorization: REDACTED },
          },
        }),
      );

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe(
        "webhook_header_values_required",
      );
      expect(await storedRow(created.id)).toMatchObject({
        actionParams: expect.objectContaining({ url: WEBHOOK_URL }),
      });
    });
  });

  describe("when an update names a different delivery channel", () => {
    /** @scenario "The delivery channel cannot be changed over the API" */
    it("refuses the save rather than ignoring the field", async () => {
      const created = await emailAutomation(`Fixed channel ${ns}`);

      const response = await patch(`/api/triggers/${created.id}`, {
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackWebhook: "https://hooks.slack.com/services/x" },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("trigger_action_immutable");
      expect(await storedRow(created.id)).toMatchObject({
        action: TriggerAction.SEND_EMAIL,
      });
    });
  });

  describe("when an update would turn an automation into a different kind", () => {
    /** @scenario "An automation cannot become an alert over the API" */
    it("refuses the save", async () => {
      const created = await emailAutomation(`Not an alert ${ns}`);

      const response = await patch(`/api/triggers/${created.id}`, {
        graphAlert: {
          seriesName: "errors",
          operator: "gt",
          threshold: 1,
          timePeriod: 5,
        },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("trigger_kind_immutable");
    });
  });

  describe("when the project no longer has the webhook channel", () => {
    /** @scenario "An existing webhook automation stays readable and manageable" */
    it("still lists, reads, renames, pauses and deletes it", async () => {
      const created = await webhookAutomation(`Grandfathered ${ns}`);

      await withWebhookChannel(false, async () => {
        const listed = (await (
          await app.request("/api/triggers", { headers: headers() })
        ).json()) as { id: string }[];
        expect(listed.some((row) => row.id === created.id)).toBe(true);

        expect(
          (
            await app.request(`/api/triggers/${created.id}`, {
              headers: headers(),
            })
          ).status,
        ).toBe(200);

        const renamed = await patch(`/api/triggers/${created.id}`, {
          name: `Grandfathered renamed ${ns}`,
        });
        expect(renamed.status).toBe(200);

        const paused = await post(`/api/triggers/${created.id}/disable`);
        expect(paused.status).toBe(200);

        const deleted = await app.request(`/api/triggers/${created.id}`, {
          method: "DELETE",
          headers: headers(),
        });
        expect(deleted.status).toBe(200);
      });
    });

    /** @scenario "Changing an existing webhook automation's delivery is refused" */
    it("refuses a save that states its delivery configuration", async () => {
      const created = await webhookAutomation(`Gated update ${ns}`);

      const response = await withWebhookChannel(false, () =>
        patch(`/api/triggers/${created.id}`, {
          actionParams: {
            url: RETARGETED_URL,
            headers: { Authorization: RETARGETED_HEADER_VALUE },
          },
        }),
      );

      expect(response.status).toBe(403);
      expect((await response.json()).error).toBe("trigger_channel_not_enabled");
    });
  });
});
