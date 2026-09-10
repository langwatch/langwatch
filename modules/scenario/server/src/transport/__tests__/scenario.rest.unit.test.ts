import { bindRestHeader } from "@langwatch/api/rest";
import { scenarioRestResponseWithPlatformUrlSchema } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import {
  createScenarioRest,
  scenarioRestErrorHandler,
  scenarioRestSurface,
} from "../scenario.rest.ts";
import {
  createScenarioRestTestApp,
  createScenarioRestTestRuntime,
  scenarioRestTestErrors,
} from "./scenario-rest.harness.ts";

function buildScenarioFamily() {
  const { app } = createScenarioRestTestApp();
  const { runtime, projectFacts } = createScenarioRestTestRuntime();
  const mounted = runtime.mount(
    createScenarioRest({
      platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    }).router(),
    {
      app: () => app,
      onError: scenarioRestErrorHandler(scenarioRestTestErrors),
      facts: [projectFacts, bindRestHeader(scenarioRestSurface, "x-langwatch-surface")],
    },
  );

  return {
    request: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

async function createScenario(
  family: ReturnType<typeof buildScenarioFamily>,
  body: Record<string, unknown>,
) {
  return family.request("/api/scenarios", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("the scenarios REST declaration", () => {
  describe("when creating with model overrides and turn limits", () => {
    /** @scenario "Create over REST accepts model overrides and turn limits" */
    it("carries the values back on create and read", async () => {
      const family = buildScenarioFamily();
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
      const family = buildScenarioFamily();
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
      await expect(
        family.request(`/api/scenarios/${created.id}`).then((response) => response.json()),
      ).resolves.toMatchObject({ simulatorModel: null });
    });
  });

  describe("when a model override has no provider prefix", () => {
    /** @scenario "REST rejects a model override with no provider prefix" */
    it("refuses the request during input parsing", async () => {
      const family = buildScenarioFamily();
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
      const family = buildScenarioFamily();
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
