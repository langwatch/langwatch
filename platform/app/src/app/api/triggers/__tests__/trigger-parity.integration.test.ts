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
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
} from "~/generated/prisma/client";
import { extractGraphAlertFromTriggerRow } from "~/server/app-layer/automations/graph-alert.builder";
import { decryptWebhookHeaders } from "~/server/app-layer/automations/providers/webhook/server";
import { PrismaTriggerRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { redactTriggerForRead } from "~/server/app-layer/automations/trigger-redaction";
import { prisma } from "~/server/db";

const testFire = vi.fn();

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
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

  const post = async (path: string, body?: Record<string, unknown>) =>
    app.request(path, {
      method: "POST",
      headers: headers(),
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  const patch = async (path: string, body: Record<string, unknown>) =>
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

  const webhookAutomation = async (name: string) =>
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
    );

  const slackWebhookAutomation = async (name: string) =>
    created(
      await createTrigger({
        name,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T000/B000/xyz",
        },
        filters: CONDITION,
      }),
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

  describe("when a report's stored configuration can no longer be read", () => {
    /** @scenario "A report with nothing readable to send says what to state" */
    it("asks for the report rather than for a different channel", async () => {
      const broken = await prisma.trigger.create({
        data: {
          id: nanoid(),
          projectId: projectId(),
          name: `Unreadable report ${ns}`,
          action: TriggerAction.SEND_EMAIL,
          // A report row whose source and schedule are gone: what it sends and
          // when are exactly what the caller now has to state.
          actionParams: { members: ["team@example.com"] },
          filters: "{}",
          triggerKind: "REPORT",
          lastRunAt: new Date().getTime(),
        },
      });

      const response = await patch(`/api/triggers/${broken.id}`, {
        actionParams: { members: ["team@example.com"] },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("report_incomplete");
    });
  });

  describe("when a delivery configuration names a field the channel has not", () => {
    /** @scenario "A field the channel does not have is refused, not dropped" */
    it("refuses the create and names both what it sent and what fits", async () => {
      const name = `Misspelt field ${ns}`;
      const response = await createTrigger({
        name,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "bot",
          slackChannelID: "C123",
        },
        filters: CONDITION,
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        error: string;
        fields?: string[];
        accepted?: string[];
      };
      expect(body.error).toBe("trigger_action_params_unknown_fields");
      expect(body.fields).toEqual(["slackChannelID"]);
      expect(body.accepted).toContain("slackChannelId");
      expect(
        await prisma.trigger.count({
          where: { projectId: projectId(), name },
        }),
      ).toBe(0);
    });

    /** @scenario "Another channel's field cannot be parked on this one" */
    it("refuses an update carrying a field from a different channel", async () => {
      const created = await emailAutomation(`No parked headers ${ns}`);

      const response = await patch(`/api/triggers/${created.id}`, {
        actionParams: {
          members: ["someone@example.com"],
          headers: { Authorization: HEADER_VALUE },
        },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe(
        "trigger_action_params_unknown_fields",
      );
      expect(await storedRow(created.id)).toMatchObject({
        actionParams: { members: ["someone@example.com"] },
      });
    });
  });

  describe("when an alert's rule is sent inside its delivery configuration", () => {
    /** @scenario "A rule sent in the delivery configuration is refused" */
    it("says where the rule belongs rather than ignoring it", async () => {
      const graph = await prisma.customGraph.create({
        data: {
          projectId: projectId(),
          name: `Latency ${ns}`,
          graph: {},
        },
      });
      const alert = await created(
        await createTrigger({
          name: `Rule in the wrong place ${ns}`,
          action: TriggerAction.SEND_EMAIL,
          actionParams: { members: ["oncall@example.com"] },
          alertType: "WARNING",
          customGraphId: graph.id,
          graphAlert: {
            seriesName: "latency",
            operator: "gt",
            threshold: 10,
            timePeriod: 15,
          },
        }),
      );

      const response = await patch(`/api/triggers/${alert.id}`, {
        actionParams: {
          members: ["oncall@example.com"],
          threshold: 99,
        },
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as {
        error: string;
        expectedField?: string;
      };
      expect(body.error).toBe("trigger_rule_fields_misplaced");
      expect(body.expectedField).toBe("graphAlert");
      expect((await storedRow(alert.id)).actionParams).toMatchObject({
        threshold: 10,
      });
    });

    /** @scenario "The read states the rule where a write states it" */
    it("hands the rule back in its own field, not in the delivery configuration", async () => {
      const graph = await prisma.customGraph.create({
        data: {
          projectId: projectId(),
          name: `Read the rule ${ns}`,
          graph: {},
        },
      });
      const alert = await created(
        await createTrigger({
          name: `Readable rule ${ns}`,
          action: TriggerAction.SEND_EMAIL,
          actionParams: { members: ["oncall@example.com"] },
          alertType: "INFO",
          customGraphId: graph.id,
          graphAlert: {
            seriesName: "latency",
            operator: "lt",
            threshold: 3,
            timePeriod: 30,
          },
        }),
      );

      const read = (await (
        await app.request(`/api/triggers/${alert.id}`, { headers: headers() })
      ).json()) as {
        actionParams: Record<string, unknown>;
        graphAlert: Record<string, unknown> | null;
      };

      expect(read.graphAlert).toMatchObject({
        seriesName: "latency",
        operator: "lt",
        threshold: 3,
        timePeriod: 30,
      });
      expect(read.actionParams).toEqual({ members: ["oncall@example.com"] });
    });
  });

  // The cap counts per project, so these run in a project of their own: a
  // shared one would make the count depend on what every other test in this
  // file had already sent.
  describe("when a project test-fires more often than a minute allows", () => {
    let capped: Project | undefined;

    const cappedHeaders = () => ({
      "X-Auth-Token": capped!.apiKey,
      "Content-Type": "application/json",
    });

    const cappedAutomation = async (body: Record<string, unknown>) => {
      const response = await app.request("/api/triggers", {
        method: "POST",
        headers: cappedHeaders(),
        body: JSON.stringify({ filters: CONDITION, ...body }),
      });
      return created(response);
    };

    const cappedTestFire = (id: string) =>
      app.request(`/api/triggers/${id}/test-fire`, {
        method: "POST",
        headers: cappedHeaders(),
      });

    beforeAll(async () => {
      capped = await prisma.project.create({
        data: {
          name: "Triggers Cap Project",
          slug: `--test-cap-project-${ns}`,
          teamId: team!.id,
          language: "other",
          framework: "other",
          apiKey: `test-cap-api-key-${ns}`,
        },
      });
    });

    afterAll(async () => {
      if (!capped) return;
      await prisma.trigger.deleteMany({ where: { projectId: capped.id } });
      await prisma.project.delete({ where: { id: capped.id } });
    });

    /** @scenario "Test fires are capped per project" */
    it("declines the eleventh in the window", async () => {
      const automation = await cappedAutomation({
        name: `Capped ${ns}`,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["someone@example.com"] },
      });

      for (let attempt = 0; attempt < 10; attempt++) {
        expect((await cappedTestFire(automation.id)).status).toBe(200);
      }

      const declined = await cappedTestFire(automation.id);

      expect(declined.status).toBe(429);
      expect((await declined.json()).error).toBe(
        "trigger_test_fire_rate_limited",
      );
      expect(testFire).toHaveBeenCalledTimes(10);
    });

    /** @scenario "A Slack test fire is not capped" */
    it("keeps sending to a destination pinned to Slack", async () => {
      const automation = await cappedAutomation({
        name: `Slack uncapped ${ns}`,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: {
          slackDelivery: "webhook",
          slackWebhook: "https://hooks.slack.com/services/T/B/x",
        },
      });

      for (let attempt = 0; attempt < 12; attempt++) {
        expect((await cappedTestFire(automation.id)).status).toBe(200);
      }
      expect(testFire).toHaveBeenCalledTimes(12);
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

    // The bot branch used to be entered on "is there a token?", which was
    // survivable while the only token lived on the row. Since ADR-093 §5 a
    // token resolves for every row in a project with a Slack integration, so a
    // webhook automation would have been test-fired through the Web API — a
    // surface it does not use and a credential it has nothing to do with.
    it("test-fires a webhook Slack automation through its webhook, never the bot API", async () => {
      const createdAutomation = await slackWebhookAutomation(
        `Slack webhook ${ns}`,
      );

      const response = await post(
        `/api/triggers/${createdAutomation.id}/test-fire`,
      );

      expect(response.status).toBe(200);
      expect(testFire).toHaveBeenCalledWith(
        expect.objectContaining({
          channel: "slack",
          webhook: "https://hooks.slack.com/services/T000/B000/xyz",
        }),
      );
      expect(testFire).not.toHaveBeenCalledWith(
        expect.objectContaining({ botDestination: expect.anything() }),
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

      const response = await patch(`/api/triggers/${created.id}`, {
        actionParams: {
          url: RETARGETED_URL,
          headers: { Authorization: RETARGETED_HEADER_VALUE },
        },
      });

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

      const response = await patch(`/api/triggers/${created.id}`, {
        actionParams: {
          url: RETARGETED_URL,
          headers: { Authorization: REDACTED },
        },
      });

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
});
