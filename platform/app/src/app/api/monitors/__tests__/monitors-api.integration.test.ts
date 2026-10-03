import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type {
  Evaluator,
  Organization,
  Project,
  Team,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { app } from "../[[...route]]/app";

const recoveryFlag = vi.hoisted(() => ({ disabled: false }));
vi.mock("~/server/app-layer/evaluations/settings-recovery-flag", () => ({
  isEvaluatorSettingsRecoveryDisabled: async () => recoveryFlag.disabled,
}));

wireDefaultTestApp();

describe("Monitors API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let evaluator: Evaluator;

  const createAuthHeaders = () => ({
    "X-Auth-Token": testApiKey,
    "Content-Type": "application/json",
  });

  const post = (path: string, body: unknown) =>
    app.request(path, {
      method: "POST",
      headers: createAuthHeaders(),
      body: JSON.stringify(body),
    });

  const patch = (path: string, body: unknown) =>
    app.request(path, {
      method: "PATCH",
      headers: createAuthHeaders(),
      body: JSON.stringify(body),
    });

  const createBody = (overrides: Record<string, unknown> = {}) => ({
    name: "Toxicity Monitor",
    checkType: "langevals/llm_boolean",
    parameters: { model: "openai/gpt-5-mini" },
    ...overrides,
  });

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;

    evaluator = await prisma.evaluator.create({
      data: {
        id: `evaluator_${nanoid()}`,
        projectId: testProjectId,
        name: "LLM Boolean Judge",
        slug: `llm-boolean-${nanoid()}`,
        type: "evaluator",
        config: {
          evaluatorType: "langevals/llm_boolean",
          settings: {},
        },
      },
    });
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["monitor", { projectId: testProjectId }],
      ["evaluator", { projectId: testProjectId }],
    ]);
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
  });

  describe("when creating a monitor", () => {
    describe("when no evaluator id is provided", () => {
      /** @scenario Creating a monitor without an evaluator is rejected */
      it("rejects the create with monitor_evaluator_required", async () => {
        const res = await post("/api/monitors", createBody());

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("monitor_evaluator_required");
        expect((body.tips as string[]).join("\n")).toContain(
          "langwatch evaluator create",
        );

        const created = await prisma.monitor.findFirst({
          where: { projectId: testProjectId },
        });
        expect(created).toBeNull();
      });
    });

    describe("when a valid evaluator id is provided", () => {
      /** @scenario Creating a monitor with an evaluator succeeds */
      it("creates the monitor with the evaluator attached", async () => {
        const res = await post(
          "/api/monitors",
          createBody({ evaluatorId: evaluator.id }),
        );

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.evaluatorId).toBe(evaluator.id);
      });
    });

    describe("when the evaluator does not exist", () => {
      /** @scenario Creating a monitor with an unknown evaluator is rejected */
      it("rejects the create as not found", async () => {
        const res = await post(
          "/api/monitors",
          createBody({ evaluatorId: "evaluator_nonexistent" }),
        );

        expect(res.status).toBe(404);
      });
    });
  });

  describe("when updating a monitor", () => {
    describe("when setting the evaluator to null", () => {
      /** @scenario Removing the evaluator from a monitor is rejected */
      it("rejects the update and keeps the evaluator", async () => {
        const createRes = await post(
          "/api/monitors",
          createBody({ evaluatorId: evaluator.id }),
        );
        const monitor = await createRes.json();

        const res = await patch(`/api/monitors/${monitor.id}`, {
          evaluatorId: null,
        });

        expect(res.status).toBe(400);
        const body = await res.json();
        expect(body.error).toBe("monitor_evaluator_required");

        const persisted = await prisma.monitor.findFirst({
          where: { id: monitor.id, projectId: testProjectId },
        });
        expect(persisted?.evaluatorId).toBe(evaluator.id);
      });
    });

    describe("when a legacy monitor has no evaluator", () => {
      /** @scenario Updating other fields of a legacy monitor without an evaluator still works */
      it("updates the name without touching the evaluator", async () => {
        const legacy = await prisma.monitor.create({
          data: {
            id: `check_${nanoid()}`,
            projectId: testProjectId,
            name: "Legacy Check",
            slug: `legacy-check-${nanoid()}`,
            checkType: "langevals/llm_boolean",
            preconditions: [],
            parameters: { model: "openai/gpt-5-mini" },
            sample: 1,
            enabled: true,
            executionMode: "ON_MESSAGE",
          },
        });

        const res = await patch(`/api/monitors/${legacy.id}`, {
          name: "Legacy Check Renamed",
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.name).toBe("Legacy Check Renamed");
        expect(body.evaluatorId).toBeNull();
      });
    });
  });

  describe("when the evaluator carries its own settings", () => {
    let blocklist: Evaluator;

    const blocklistBody = (overrides: Record<string, unknown> = {}) => ({
      name: "Competitor Monitor",
      checkType: "langevals/competitor_blocklist",
      evaluatorId: blocklist.id,
      ...overrides,
    });

    const evaluatorWith = (competitors: string[]) =>
      prisma.evaluator.create({
        data: {
          id: `evaluator_${nanoid()}`,
          projectId: testProjectId,
          name: "Competitor Blocklist",
          slug: `competitor-blocklist-${nanoid()}`,
          type: "evaluator",
          config: {
            evaluatorType: "langevals/competitor_blocklist",
            settings: { competitors },
          },
        },
      });

    beforeEach(async () => {
      blocklist = await evaluatorWith(["Acme"]);
    });

    it("refuses a create whose parameters would never run", async () => {
      const res = await post(
        "/api/monitors",
        blocklistBody({ parameters: { competitors: ["Globex"] } }),
      );

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("monitor_parameters_unused");
      expect(body.evaluatorId).toBe(blocklist.id);
      expect(
        await prisma.monitor.findFirst({ where: { projectId: testProjectId } }),
      ).toBeNull();
    });

    it("accepts parameters that repeat the evaluator's settings", async () => {
      const res = await post(
        "/api/monitors",
        blocklistBody({ parameters: { competitors: ["Acme"] } }),
      );

      expect(res.status).toBe(201);
    });

    it("accepts a create without parameters", async () => {
      const res = await post("/api/monitors", blocklistBody());

      expect(res.status).toBe(201);
    });

    it("refuses an update whose parameters would never run", async () => {
      const monitor = await (
        await post("/api/monitors", blocklistBody())
      ).json();

      const res = await patch(`/api/monitors/${monitor.id}`, {
        parameters: { competitors: ["Globex"] },
      });

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("monitor_parameters_unused");
      const persisted = await prisma.monitor.findFirst({
        where: { id: monitor.id, projectId: testProjectId },
      });
      expect(persisted?.parameters).toEqual({});
    });

    it("checks the parameters against the evaluator the update moves to", async () => {
      const monitor = await (
        await post("/api/monitors", blocklistBody())
      ).json();
      const other = await evaluatorWith(["Initech"]);

      const res = await patch(`/api/monitors/${monitor.id}`, {
        evaluatorId: other.id,
        parameters: { competitors: ["Acme"] },
      });

      expect(res.status).toBe(422);
      expect((await res.json()).evaluatorId).toBe(other.id);
    });

    it("refuses a move that would leave the stored parameters unused", async () => {
      const monitor = await (
        await post(
          "/api/monitors",
          blocklistBody({ parameters: { competitors: ["Acme"] } }),
        )
      ).json();
      const other = await evaluatorWith(["Initech"]);

      const res = await patch(`/api/monitors/${monitor.id}`, {
        evaluatorId: other.id,
      });

      expect(res.status).toBe(422);
      const body = await res.json();
      expect(body.error).toBe("monitor_parameters_unused");
      expect(body.evaluatorId).toBe(other.id);
      const persisted = await prisma.monitor.findFirst({
        where: { id: monitor.id, projectId: testProjectId },
      });
      expect(persisted?.evaluatorId).toBe(blocklist.id);
    });

    it("accepts a move that clears the parameters", async () => {
      const monitor = await (
        await post(
          "/api/monitors",
          blocklistBody({ parameters: { competitors: ["Acme"] } }),
        )
      ).json();
      const other = await evaluatorWith(["Initech"]);

      const res = await patch(`/api/monitors/${monitor.id}`, {
        evaluatorId: other.id,
        parameters: {},
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.evaluatorId).toBe(other.id);
      expect(body.parameters).toEqual({});
      const persisted = await prisma.monitor.findFirst({
        where: { id: monitor.id, projectId: testProjectId },
      });
      expect(persisted?.parameters).toEqual({});
    });

    const createOverTopLevelPrompt = async () => {
      const topLevel = await prisma.evaluator.create({
        data: {
          id: `evaluator_${nanoid()}`,
          projectId: testProjectId,
          name: "Top-level Judge",
          slug: `top-level-judge-${nanoid()}`,
          type: "evaluator",
          config: {
            evaluatorType: "langevals/llm_boolean",
            prompt: "Is the reply polite?",
          },
        },
      });
      return post(
        "/api/monitors",
        createBody({
          evaluatorId: topLevel.id,
          parameters: { prompt: "Is the reply rude?" },
        }),
      );
    };

    it("refuses parameters over a prompt recovered from the top of the config", async () => {
      const res = await createOverTopLevelPrompt();

      expect(res.status).toBe(422);
      expect((await res.json()).error).toBe("monitor_parameters_unused");
    });

    describe("when the operator has rolled the settings recovery back", () => {
      beforeEach(() => {
        recoveryFlag.disabled = true;
      });
      afterEach(() => {
        recoveryFlag.disabled = false;
      });

      it("accepts the parameters, since the runner reads them", async () => {
        const res = await createOverTopLevelPrompt();

        expect(res.status).toBe(201);
      });
    });
  });

  describe("when a monitor without an evaluator is given parameters", () => {
    it("stores them, since they are what runs", async () => {
      const legacy = await prisma.monitor.create({
        data: {
          id: `check_${nanoid()}`,
          projectId: testProjectId,
          name: "Legacy Blocklist",
          slug: `legacy-blocklist-${nanoid()}`,
          checkType: "langevals/competitor_blocklist",
          preconditions: [],
          parameters: { competitors: ["Acme"] },
          sample: 1,
          enabled: true,
          executionMode: "ON_MESSAGE",
        },
      });

      const res = await patch(`/api/monitors/${legacy.id}`, {
        parameters: { competitors: ["Globex"] },
      });

      expect(res.status).toBe(200);
      expect((await res.json()).parameters).toEqual({
        competitors: ["Globex"],
      });
    });
  });
});
