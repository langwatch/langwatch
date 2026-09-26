import { bindRestHeader } from "@langwatch/api/rest";
import { scenarioRestResponseWithPlatformUrlSchema } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { createScenarioRest, scenarioRestSurface } from "../scenario.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  PROJECT_ID,
  scenarioRestTestErrors,
} from "./scenario-rest.harness.ts";

async function buildScenarioFamily(
  runtimeOptions?: Parameters<typeof createScenarioRestTestRuntime>[0],
) {
  const { app } = await createScenarioRestTestApp();
  const { runtime, projectFacts } = createScenarioRestTestRuntime(runtimeOptions);
  const mounted = runtime.mount(createScenarioRest().router(), {
    app: () => app,
    onError: scenarioRestTestErrors,
    facts: [projectFacts, bindRestHeader(scenarioRestSurface, "x-langwatch-surface")],
  });

  return {
    app,
    request: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

async function createScenario(
  family: Awaited<ReturnType<typeof buildScenarioFamily>>,
  body: Record<string, unknown>,
) {
  return family.request("/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the scenarios REST declaration", () => {
  describe("when a legacy project key creates a scenario", () => {
    it("creates the scenario with no user attached, rather than crashing", async () => {
      // A legacy project key names no person: the door's actor rule answers
      // the project id for `actorId`, which is not a `User` row. Before the
      // fix this crashed the write with the `lastUpdatedById` foreign key.
      const family = await buildScenarioFamily({ viewerUserId: null, actorId: PROJECT_ID });

      const response = await createScenario(family, {
        name: "Project-key Scenario",
        situation: "A project-bound key creates this",
      });

      expect(response.status).toBe(201);
      const created = scenarioRestResponseWithPlatformUrlSchema.parse(await response.json());
      const row = await family.app.getById({ id: created.id, projectId: PROJECT_ID });
      expect(row.lastUpdatedById).toBeNull();
    });
  });

  describe("when creating with model overrides and turn limits", () => {
    /** @scenario "Create over REST accepts model overrides and turn limits" */
    it("carries the values back on create and read", async () => {
      const family = await buildScenarioFamily();
      const createdResponse = await createScenario(family, {
        name: "Overrides Scenario",
        situation: "User asks for a refund",
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
        maxTurns: 8,
        minTurns: 2,
      });

      expect(createdResponse.status).toBe(201);
      const created = scenarioRestResponseWithPlatformUrlSchema.parse(await createdResponse.json());
      expect(created).toMatchObject({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
        maxTurns: 8,
        minTurns: 2,
      });
      const readResponse = await family.request(`/api/scenarios/${created.id}`);
      expect(readResponse.status).toBe(200);
      await expect(readResponse.json()).resolves.toMatchObject({
        simulatorModel: "openai/gpt-5-mini",
        judgeModel: "openai/gpt-5-mini",
        maxTurns: 8,
        minTurns: 2,
      });
    });
  });

  describe("when clearing a model override", () => {
    /** @scenario "Update over REST clears a model override with null" */
    it("stores and returns null", async () => {
      const family = await buildScenarioFamily();
      const createdResponse = await createScenario(family, {
        name: "Clear Override Scenario",
        situation: "User asks for help",
        simulatorModel: "openai/gpt-5-mini",
      });
      const created = scenarioRestResponseWithPlatformUrlSchema.parse(await createdResponse.json());

      const updated = await family.request(`/api/scenarios/${created.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ simulatorModel: null }),
      });

      expect(updated.status).toBe(200);
      await expect(updated.json()).resolves.toMatchObject({ simulatorModel: null });
      const followup = await family.request(`/api/scenarios/${created.id}`);
      await expect(followup.json()).resolves.toMatchObject({ simulatorModel: null });
    });
  });

  describe("when a model override has no provider prefix", () => {
    /** @scenario "REST rejects a model override with no provider prefix" */
    it("refuses the request during input parsing", async () => {
      const family = await buildScenarioFamily();
      const response = await createScenario(family, {
        name: "Bad Model Scenario",
        situation: "User asks for help",
        simulatorModel: "latest",
      });

      expect(response.status).toBe(422);
    });
  });

  describe("when partially updating an existing scenario", () => {
    /** @scenario "PATCH updates a scenario the same way PUT does" */
    it("changes only the named field", async () => {
      const family = await buildScenarioFamily();
      const createdResponse = await createScenario(family, {
        name: "Patch Me",
        situation: "Original situation",
      });
      const created = scenarioRestResponseWithPlatformUrlSchema.parse(await createdResponse.json());

      const response = await family.request(`/api/scenarios/${created.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "Patched Name" }),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        name: "Patched Name",
        situation: "Original situation",
      });
    });
  });
});

describe("given an id no scenario in this project carries", () => {
  /**
   * The transport used to catch `ScenarioNotFoundError` and rethrow it as a
   * plain Error so a family handler could word the miss, which left the
   * boundary nothing to render but "An unknown error occurred" — apidiff run
   * 20260916-r6 read main answering 404 and this branch answering 500.
   *
   * @scenario "A scenario this project does not hold is refused as a named miss"
   */
  it("answers 404 with the code the caller can act on", async () => {
    const family = await buildScenarioFamily();

    const response = await family.request("/api/scenarios/scenario-nobody-holds");

    expect(response.status).toBe(404);
    // The code, not the sentence: the sentence is copy the registry owns.
    await expect(response.json()).resolves.toMatchObject({ error: "scenario_not_found" });
  });
});
