import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  PlanProviderService,
  type PlanProvider,
} from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";

import { app as triggersApp } from "../../triggers/[[...route]]/app";
import { app as monitorsApp } from "../../monitors/[[...route]]/app";
import { app as graphsApp } from "../../graphs/[[...route]]/app";
import { app as suitesApp } from "../../suites/[[...route]]/app";

/**
 * Integration tests verifying that resourceLimitMiddleware is correctly wired
 * into each REST route that creates resources. Each test creates enough resources
 * to hit the free plan limit, then verifies the next creation returns 403.
 *
 * See: https://github.com/langwatch/langwatch/issues/3352
 */
describe("Feature: REST API resource limit enforcement parity", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;

  const authHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    resetApp();
    const mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
    });

    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = projectFactory.build({ slug: nanoid() });
    testProject = await prisma.project.create({
      data: {
        ...testProject,
        teamId: testTeam.id,
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
  });

  afterEach(async () => {
    if (!testProjectId) return;

    await prisma.trigger.deleteMany({ where: { projectId: testProjectId } });
    await prisma.monitor.deleteMany({ where: { projectId: testProjectId } });
    await prisma.customGraph.deleteMany({ where: { projectId: testProjectId } });
    await prisma.simulationSuite.deleteMany({ where: { projectId: testProjectId } });
    await prisma.experiment.deleteMany({ where: { projectId: testProjectId } });
    await prisma.scenario.deleteMany({ where: { projectId: testProjectId } });
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
    resetApp();
  });

  describe("POST /api/triggers (automations limit)", () => {
    const limit = FREE_PLAN.maxAutomations;

    describe("when below the limit", () => {
      it("allows creation and returns 201", async () => {
        const res = await triggersApp.request("/api/triggers", {
          method: "POST",
          headers: authHeaders(testApiKey),
          body: JSON.stringify({
            name: "First Trigger",
            action: "SEND_EMAIL",
          }),
        });

        expect(res.status).toBe(201);
        const body = await res.json();
        expect(body.name).toBe("First Trigger");
      });
    });

    describe("when the automations limit is reached", () => {
      beforeEach(async () => {
        for (let i = 0; i < limit; i++) {
          await prisma.trigger.create({
            data: {
              id: nanoid(),
              projectId: testProjectId,
              name: `Trigger ${i}`,
              action: "SEND_EMAIL",
              actionParams: {},
              filters: "{}",
              lastRunAt: Date.now(),
            },
          });
        }
      });

      it("returns 403 with resource_limit_exceeded", async () => {
        const res = await triggersApp.request("/api/triggers", {
          method: "POST",
          headers: authHeaders(testApiKey),
          body: JSON.stringify({
            name: "Excess Trigger",
            action: "SEND_EMAIL",
          }),
        });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("resource_limit_exceeded");
        expect(body.limitType).toBe("automations");
        expect(body.current).toBe(limit);
        expect(body.max).toBe(limit);
      });
    });
  });

  describe("POST /api/monitors (onlineEvaluations limit)", () => {
    const limit = FREE_PLAN.maxOnlineEvaluations;

    describe("when the onlineEvaluations limit is reached", () => {
      beforeEach(async () => {
        for (let i = 0; i < limit; i++) {
          await prisma.monitor.create({
            data: {
              projectId: testProjectId,
              name: `Monitor ${i}`,
              slug: `monitor-${i}-${nanoid(5)}`,
              checkType: "custom",
              executionMode: "ON_MESSAGE",
              preconditions: [],
              parameters: {},
              sample: 1.0,
              enabled: true,
              level: "trace",
            },
          });
        }
      });

      it("returns 403 with resource_limit_exceeded", async () => {
        const res = await monitorsApp.request("/api/monitors", {
          method: "POST",
          headers: authHeaders(testApiKey),
          body: JSON.stringify({
            name: "Excess Monitor",
            checkType: "custom",
          }),
        });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("resource_limit_exceeded");
        expect(body.limitType).toBe("onlineEvaluations");
        expect(body.current).toBe(limit);
        expect(body.max).toBe(limit);
      });
    });
  });

  describe("POST /api/graphs (customGraphs limit)", () => {
    const limit = FREE_PLAN.maxCustomGraphs;

    describe("when the customGraphs limit is reached", () => {
      beforeEach(async () => {
        for (let i = 0; i < limit; i++) {
          await prisma.customGraph.create({
            data: {
              id: nanoid(),
              projectId: testProjectId,
              name: `Graph ${i}`,
              graph: {},
            },
          });
        }
      });

      it("returns 403 with resource_limit_exceeded", async () => {
        const res = await graphsApp.request("/api/graphs", {
          method: "POST",
          headers: authHeaders(testApiKey),
          body: JSON.stringify({
            name: "Excess Graph",
            graph: { type: "bar" },
          }),
        });

        expect(res.status).toBe(403);
        const body = await res.json();
        expect(body.error).toBe("resource_limit_exceeded");
        expect(body.limitType).toBe("customGraphs");
        expect(body.current).toBe(limit);
        expect(body.max).toBe(limit);
      });
    });
  });

  describe("POST /api/suites (experiments limit)", () => {
    const limit = FREE_PLAN.maxExperiments;

    describe("when the experiments limit is reached", () => {
      beforeEach(async () => {
        for (let i = 0; i < limit; i++) {
          await prisma.experiment.create({
            data: {
              projectId: testProjectId,
              name: `Experiment ${i}`,
              slug: `experiment-${i}-${nanoid(5)}`,
              type: "BATCH_EVALUATION",
              workbenchState: { task: "batch" },
            },
          });
        }
      });

      it("returns 403 with resource_limit_exceeded", async () => {
        const scenario = await prisma.scenario.create({
          data: {
            projectId: testProjectId,
            name: "Test Scenario",
            situation: "Test situation",
            criteria: ["criterion"],
            labels: [],
          },
        });

        const res = await suitesApp.request("/api/suites", {
          method: "POST",
          headers: authHeaders(testApiKey),
          body: JSON.stringify({
            name: "Excess Suite",
            scenarioIds: [scenario.id],
            targets: [{ type: "http", referenceId: "agent_test" }],
          }),
        });

        const body = await res.json();
        expect(res.status).toBe(403);
        expect(body.error).toBe("resource_limit_exceeded");
        expect(body.limitType).toBe("experiments");
        expect(body.current).toBe(limit);
        expect(body.max).toBe(limit);
      });
    });
  });
});
