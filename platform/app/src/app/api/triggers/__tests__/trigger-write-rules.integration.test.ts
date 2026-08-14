/**
 * An automation written over the API is the same row the dashboard writes and
 * the same row the dispatcher reads, so the API is held to the rules the
 * dashboard is held to. These run against the real route, the real service and
 * the real database, because the rules being asserted are the ones that decide
 * what reaches storage.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
} from "~/generated/prisma/client";
import { PrismaTriggerRepository } from "~/server/app-layer/automations/repositories/trigger.prisma.repository";
import { TriggerService } from "~/server/app-layer/automations/trigger.service";
import { prisma } from "~/server/db";

vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({
    triggers: new TriggerService(new PrismaTriggerRepository(prisma)),
  }),
}));

import { app } from "../[[...route]]/app";

const CONDITION = { "metadata.labels": ["prod"] };

describe("Feature: the API saves what the dashboard would accept", () => {
  const ns = `triggers-write-rules-${nanoid(8)}`;

  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;

  const projectId = () => project!.id;

  const headers = () => ({
    "X-Auth-Token": project!.apiKey,
    "Content-Type": "application/json",
  });

  const createTrigger = async (body: Record<string, unknown>) =>
    app.request("/api/triggers", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ filters: CONDITION, ...body }),
    });

  const countNamed = (name: string) =>
    prisma.trigger.count({ where: { projectId: projectId(), name } });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Triggers Rules Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Triggers Rules Team",
        slug: `--test-team-${ns}`,
        organizationId: organization!.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Triggers Rules Project",
        slug: `--test-project-${ns}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
  });

  afterAll(async () => {
    if (project) {
      await prisma.trigger.deleteMany({ where: { projectId: projectId() } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
  });

  describe("when a delivery configuration names no destination", () => {
    /** @scenario "A delivery configuration its channel does not recognise is refused" */
    it("refuses the save and creates nothing", async () => {
      const name = `No destination ${ns}`;
      const response = await createTrigger({
        name,
        action: TriggerAction.SEND_SLACK_MESSAGE,
        actionParams: { slackDelivery: "webhook" },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("invalid_action_params");
      expect(await countNamed(name)).toBe(0);
    });
  });

  describe("when the destination is not https", () => {
    /** @scenario "A destination that is not https is refused" */
    it("refuses the save and creates nothing", async () => {
      const name = `Insecure destination ${ns}`;
      const response = await createTrigger({
        name,
        action: TriggerAction.SEND_WEBHOOK,
        actionParams: { url: "http://example.com/hooks/langwatch" },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("invalid_action_params");
      expect(await countNamed(name)).toBe(0);
    });
  });

  describe("when a notification automation is created", () => {
    /** @scenario "A new notification automation starts on the cadence that protects against storms" */
    it("starts it on the digest cadence a dashboard-authored one starts on", async () => {
      const name = `Emails on match ${ns}`;
      const response = await createTrigger({
        name,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["someone@example.com"] },
      });

      expect(response.status).toBe(201);
      const created = (await response.json()) as { id: string };
      expect(
        await prisma.trigger.findUniqueOrThrow({
          where: { id: created.id, projectId: projectId() },
        }),
      ).toMatchObject({ notificationCadence: "5min_digest" });
    });
  });

  describe("when every condition names something unsupported", () => {
    /** @scenario "An automation whose only conditions are unsupported is refused" */
    it("refuses the save and creates nothing", async () => {
      const name = `Unsupported conditions ${ns}`;
      const response = await createTrigger({
        name,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["someone@example.com"] },
        filters: { "topics.retired_field": ["anything"] },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("trigger_filters_unsupported");
      expect(await countNamed(name)).toBe(0);
    });
  });

  describe("when an automation has been paused", () => {
    /** @scenario "The listing includes paused automations" */
    it("keeps it in the listing", async () => {
      const name = `Paused ${ns}`;
      const createResponse = await createTrigger({
        name,
        action: TriggerAction.SEND_EMAIL,
        actionParams: { members: ["someone@example.com"] },
      });
      expect(createResponse.status).toBe(201);
      const created = (await createResponse.json()) as { id: string };

      const paused = await app.request(`/api/triggers/${created.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ active: false }),
      });
      expect(paused.status).toBe(200);

      const listed = (await (
        await app.request("/api/triggers", { headers: headers() })
      ).json()) as { id: string; active: boolean }[];
      expect(listed.find((row) => row.id === created.id)).toMatchObject({
        active: false,
      });
    });
  });

  describe("when the automation is not this project's", () => {
    /** @scenario "An automation in another project reads as one that does not exist" */
    it("reads as an automation that does not exist", async () => {
      const elsewhere = await prisma.project.create({
        data: {
          name: "Someone Else's Rules Project",
          slug: `--test-other-project-${ns}`,
          teamId: team!.id,
          language: "other",
          framework: "other",
          apiKey: `test-other-api-key-${ns}`,
        },
      });
      // Cleaned in `finally` so a failing assertion can't leak the foreign
      // project into later runs.
      try {
        const theirs = await prisma.trigger.create({
          data: {
            id: nanoid(),
            projectId: elsewhere.id,
            name: `Theirs ${ns}`,
            action: TriggerAction.SEND_EMAIL,
            actionParams: { members: ["them@example.com"] },
            filters: JSON.stringify(CONDITION),
            lastRunAt: new Date().getTime(),
          },
        });

        const response = await app.request(`/api/triggers/${theirs.id}`, {
          headers: headers(),
        });

        expect(response.status).toBe(404);
        expect((await response.json()).error).toBe("trigger_not_found");
      } finally {
        await prisma.trigger.deleteMany({ where: { projectId: elsewhere.id } });
        await prisma.project.delete({ where: { id: elsewhere.id } });
      }
    });
  });
});
