/**
 * The REST create route did not merely ACCEPT a condition-less automation, it
 * manufactured one: `filters` carried a `.default({})`, so the smallest
 * possible create call produced an automation matching every trace forever.
 * These run against the real route and the real database because the defect
 * lived in the wire schema, which a service-level test never sees.
 */
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "~/server/db";

// The route invalidates the active-triggers cache after a successful write.
// That is the only thing it needs the app layer for, and booting the whole app
// to no-op one cache drop would buy nothing this suite asserts.
vi.mock("~/server/app-layer/app", () => ({
  getApp: () => ({ triggers: { invalidate: async () => {} } }),
}));

import { app } from "../[[...route]]/app";

describe("Feature: a REST-created automation must carry a condition", () => {
  const ns = `triggers-condition-${nanoid(8)}`;

  let organization: Organization;
  let team: Team;
  let project: Project;

  const headers = () => ({
    "X-Auth-Token": project.apiKey,
    "Content-Type": "application/json",
  });

  const createTrigger = (body: Record<string, unknown>) =>
    app.request("/api/triggers", {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Triggers API Org", slug: `--test-org-${ns}` },
    });
    team = await prisma.team.create({
      data: {
        name: "Triggers API Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Triggers API Project",
        slug: `--test-project-${ns}`,
        teamId: team.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
  });

  afterAll(async () => {
    if (!organization?.id) return;
    await prisma.trigger.deleteMany({ where: { projectId: project.id } });
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.team.delete({ where: { id: team.id } });
    await prisma.organization.delete({ where: { id: organization.id } });
  });

  describe("when the create request omits the condition entirely", () => {
    /** @scenario "The REST API no longer invents an empty condition" */
    it("refuses it with the machine-readable condition-required code", async () => {
      const response = await createTrigger({
        name: "Omitted condition",
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: { datasetId: "dataset_1" },
      });

      expect(response.status).toBe(422);
      const body = (await response.json()) as Record<string, unknown>;
      expect(body.error).toBe("trigger_filters_required");
      expect(
        await prisma.trigger.count({
          where: { projectId: project.id, name: "Omitted condition" },
        }),
      ).toBe(0);
    });
  });

  describe("when the create request sends an empty condition", () => {
    it("refuses it the same way as an omitted one", async () => {
      const response = await createTrigger({
        name: "Empty condition",
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: { datasetId: "dataset_1" },
        filters: {},
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("trigger_filters_required");
    });

    it("refuses a condition whose only field selects nothing", async () => {
      // `{ "metadata.labels": [] }` reads like a filter and matches every
      // trace, so it has to be refused as the empty object is.
      const response = await createTrigger({
        name: "Vacuous condition",
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: { datasetId: "dataset_1" },
        filters: { "metadata.labels": [] },
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("trigger_filters_required");
    });
  });

  describe("when the create request carries a real condition", () => {
    it("creates the automation", async () => {
      const response = await createTrigger({
        name: "Real condition",
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: { datasetId: "dataset_1" },
        filters: { "metadata.labels": ["prod"] },
      });

      expect(response.status).toBe(201);
      expect(
        await prisma.trigger.count({
          where: { projectId: project.id, name: "Real condition" },
        }),
      ).toBe(1);
    });
  });

  describe("when a patch would clear the last condition", () => {
    it("refuses it and leaves the stored condition alone", async () => {
      const stored = await prisma.trigger.create({
        data: {
          id: nanoid(),
          name: "Patch target",
          projectId: project.id,
          action: TriggerAction.ADD_TO_DATASET,
          actionParams: {},
          filters: JSON.stringify({ "metadata.labels": ["prod"] }),
          triggerKind: TriggerKind.AUTOMATION,
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ filters: {} }),
      });

      expect(response.status).toBe(422);
      expect((await response.json()).error).toBe("trigger_filters_required");
      const after = await prisma.trigger.findUniqueOrThrow({
        where: { id: stored.id, projectId: project.id },
      });
      expect(after.filters).toBe(
        JSON.stringify({ "metadata.labels": ["prod"] }),
      );
    });

    it("allows it when a query still narrows the automation", async () => {
      const stored = await prisma.trigger.create({
        data: {
          id: nanoid(),
          name: "Query-narrowed",
          projectId: project.id,
          action: TriggerAction.ADD_TO_DATASET,
          actionParams: {},
          filters: JSON.stringify({ "metadata.labels": ["prod"] }),
          filterQuery: "status:error",
          triggerKind: TriggerKind.AUTOMATION,
        },
      });

      const response = await app.request(`/api/triggers/${stored.id}`, {
        method: "PATCH",
        headers: headers(),
        body: JSON.stringify({ filters: {} }),
      });

      expect(response.status).toBe(200);
    });
  });
});
