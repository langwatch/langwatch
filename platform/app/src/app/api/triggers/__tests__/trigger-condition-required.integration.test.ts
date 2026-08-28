/**
 * The REST create route did not merely ACCEPT a condition-less automation, it
 * manufactured one: `filters` carried a `.default({})`, so the smallest
 * possible create call produced an automation matching every trace forever.
 * These run against the real route and the real database because the defect
 * lived in the wire schema, which a service-level test never sees.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  type Organization,
  type Project,
  type Team,
  TriggerAction,
  TriggerKind,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";

// The route invalidates the active-triggers cache after a successful write.
// That is the only thing it needs the app layer for, and booting the whole app
// to no-op one cache drop would buy nothing this suite asserts.
vi.mock("~/server/app-layer/app", () => ({
  // Consumers that degrade without Redis read through this one.
  tryGetApp: () => null,
  getApp: () => ({ triggers: { invalidate: async () => {} } }),
}));

import { createTriggerRestApp } from "@langwatch/platform-api";
import { appRestSecurity } from "~/server/api/security";
import { getApp } from "~/server/app-layer/app";
import { platformUrl } from "../../shared/platform-url";

const { hono: app } = createTriggerRestApp({
  security: appRestSecurity,
  automation: () => getApp().automation,
  platformUrl,
});

describe("Feature: a REST-created automation must carry a condition", () => {
  const ns = `triggers-condition-${nanoid(8)}`;

  // Optional until `beforeAll` has created them: a setup failure part way
  // through must not make teardown throw on an undefined id, because that
  // TypeError replaces the real setup error in the CI output.
  let organization: Organization | undefined;
  let team: Team | undefined;
  let project: Project | undefined;

  const projectId = () => project!.id;

  const headers = () => ({
    "X-Auth-Token": project!.apiKey,
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
        organizationId: organization!.id,
      },
    });
    project = await prisma.project.create({
      data: {
        name: "Triggers API Project",
        slug: `--test-project-${ns}`,
        teamId: team!.id,
        language: "other",
        framework: "other",
        apiKey: `test-api-key-${ns}`,
      },
    });
  });

  afterAll(async () => {
    // Innermost first, and each one guarded on its own.
    if (project) {
      await prisma.trigger.deleteMany({ where: { projectId: projectId() } });
      await prisma.project.delete({ where: { id: project.id } });
    }
    if (team) await prisma.team.delete({ where: { id: team.id } });
    if (organization) {
      await prisma.organization.delete({ where: { id: organization.id } });
    }
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
          where: { projectId: projectId(), name: "Omitted condition" },
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

    it("refuses a key selector that carries no values", async () => {
      // The one shape that used to slip through: the outer object has a key,
      // so a shallow check called it a condition, while the matcher discards
      // the empty leaf and fires on every trace. Both now share one recursive
      // vacuity check, so this is refused like the empty object.
      const response = await createTrigger({
        name: "Vacuous key selector",
        action: TriggerAction.ADD_TO_DATASET,
        actionParams: { datasetId: "dataset_1" },
        filters: { "metadata.labels": { region: [] } },
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
          where: { projectId: projectId(), name: "Real condition" },
        }),
      ).toBe(1);
    });
  });

  describe("when a patch would clear the last condition", () => {
    /** @scenario "A REST edit that empties the condition changes nothing" */
    it("refuses it and leaves the stored condition alone", async () => {
      const stored = await prisma.trigger.create({
        data: {
          id: nanoid(),
          name: "Patch target",
          projectId: projectId(),
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
        where: { id: stored.id, projectId: projectId() },
      });
      expect(after.filters).toBe(JSON.stringify({ "metadata.labels": ["prod"] }));
    });

    it("allows it when a query still narrows the automation", async () => {
      const stored = await prisma.trigger.create({
        data: {
          id: nanoid(),
          name: "Query-narrowed",
          projectId: projectId(),
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
