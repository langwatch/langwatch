/**
 * The `/api/scenarios` REST family's model-override and turn-limit fields,
 * @see specs/scenarios/scenario-api.feature
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { SimulationService } from "@langwatch/scenario-contract";
import type { ErrorHandler, MiddlewareHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { ScenarioTestSuiteIdPort, ScenarioIdPort } from "../../../ports/scenario-id.port";
import { ScenarioClockPort } from "../../../ports/scenario-clock.port";
import { ScenarioSecretCipherPort } from "../../../ports/scenario-secret-cipher.port";
import { ScenarioService } from "../../../services/scenario.service";
import { MemoryScenarioRepository } from "../../../repositories/__tests__/fixtures/memory-scenario.repository";
import { createScenariosRestApp } from "../scenario.api";

const PROJECT_ID = "project_scenarios";
const PROJECT_SLUG = "scenarios-project";

const renderHandled: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) return error.getResponse();
  const handled = error as { httpStatus?: number; code?: string; message?: string };
  if (typeof handled.httpStatus === "number") {
    return c.json(
      { error: handled.code ?? "error", message: handled.message ?? "" },
      handled.httpStatus as never,
    );
  }
  return c.json({ error: String(error) }, 500);
};

function testSecurity(): AppRestSecurity {
  const pass: MiddlewareHandler = async (_c, next) => next();
  const asProject: MiddlewareHandler = async (c, next) => {
    c.set("project", {
      id: PROJECT_ID,
      name: "Scenarios Project",
      slug: PROJECT_SLUG,
      teamId: "team_1",
      organizationId: "org_1",
      isPersonal: false,
      ownerUserId: null,
    });
    await next();
  };
  const ports: RestApiServicePorts = {
    appContext: async (_c, next) => next(),
    requestLogger: () => async (_c, next) => next(),
    requestTracer: () => async (_c, next) => next(),
    legacyErrorHandler: renderHandled,
    canonicalErrorHandler: renderHandled,
    authenticateProject: () => asProject,
    authorizeProjectPermission: () => pass,
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

let nextId = 0;

function harness() {
  const repository = MemoryScenarioRepository.create();
  const scenarios = ScenarioService.create({
    repository,
    simulations: Object.create(SimulationService.prototype) as SimulationService,
    ids: {
      next: () => `scenario_${(nextId += 1)}`,
    } as ScenarioIdPort,
    testSuiteIds: { next: () => `test_suite_${nextId}` } as ScenarioTestSuiteIdPort,
    clock: { now: () => new Date() } as ScenarioClockPort,
    secretCipher: {
      encrypt: (v: string) => v,
      decrypt: (v: string) => v,
    } as ScenarioSecretCipherPort,
  });

  const app = createScenariosRestApp({
    security: testSecurity(),
    scenarios: () => scenarios,
    platformUrl: () => "https://app.langwatch.test/scenarios/edit",
  });

  return { app };
}

describe("model overrides and turn limits over REST", () => {
  describe("when creating with model overrides and turn limits", () => {
    /** @scenario "Create over REST accepts model overrides and turn limits" */
    it("carries the values back on create and on read", async () => {
      const { app } = harness();

      const createRes = await app.hono!.request("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Overrides Scenario",
          situation: "User asks for a refund",
          simulatorModel: "openai/gpt-5-mini",
          judgeModel: "openai/gpt-5-mini",
          maxTurns: 8,
          minTurns: 2,
        }),
      });

      expect(createRes.status).toBe(201);
      const created = (await createRes.json()) as { id: string };
      expect(created).toMatchObject({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
        maxTurns: 8,
        minTurns: 2,
      });

      const readRes = await app.hono!.request(`/api/scenarios/${created.id}`);
      expect(readRes.status).toBe(200);
      const read = await readRes.json();
      expect(read).toMatchObject({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
        maxTurns: 8,
        minTurns: 2,
      });
    });
  });

  describe("when updating an override to null", () => {
    /** @scenario "Update over REST clears a model override with null" */
    it("clears the stored override", async () => {
      const { app } = harness();

      const createRes = await app.hono!.request("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Clear Override Scenario",
          situation: "User asks for help",
          simulatorModel: "openai/gpt-5-mini",
        }),
      });
      const created = (await createRes.json()) as { id: string };

      const updateRes = await app.hono!.request(`/api/scenarios/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ simulatorModel: null }),
      });
      expect(updateRes.status).toBe(200);
      const updated = (await updateRes.json()) as { simulatorModel: string | null };
      expect(updated.simulatorModel).toBeNull();

      const readRes = await app.hono!.request(`/api/scenarios/${created.id}`);
      const read = (await readRes.json()) as { simulatorModel: string | null };
      expect(read.simulatorModel).toBeNull();
    });
  });

  describe("when the override has no provider prefix", () => {
    /** @scenario "REST rejects a model override with no provider prefix" */
    it("rejects the create with a validation error", async () => {
      const { app } = harness();

      const res = await app.hono!.request("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Bad Model Scenario",
          situation: "User asks for help",
          simulatorModel: "latest",
        }),
      });

      expect(res.status).toBe(422);
    });
  });
});

describe("PATCH /api/scenarios/:id", () => {
  describe("when the scenario exists", () => {
    /** @scenario "PATCH updates a scenario the same way PUT does" */
    it("updates the scenario like PUT does", async () => {
      const { app } = harness();

      const createRes = await app.hono!.request("/api/scenarios", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Patch Me",
          situation: "Original situation",
        }),
      });
      const created = (await createRes.json()) as { id: string };

      const res = await app.hono!.request(`/api/scenarios/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Patched Name" }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { name: string; situation: string };
      expect(body.name).toBe("Patched Name");
      expect(body.situation).toBe("Original situation");
    });
  });
});
