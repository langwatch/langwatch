import type { Agent, Experiment, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";

/**
 * Integration tests for POST /api/experiments/:slug/comparison.
 *
 * Requires the app running at TEST_BASE_URL (default http://localhost:5560).
 * Mirrors the harness conventions in cicd-execution.integration.test.ts.
 */
describe.skipIf(process.env.CI)("POST /api/experiments/:slug/comparison", () => {
  let project: Project;
  let experiment: Experiment;
  let agent: Agent;
  const testSlug = `comparison-cli-test-${Date.now()}`;

  const getBaseUrl = () => process.env.TEST_BASE_URL ?? "http://localhost:5560";

  const post = (slug: string, body: unknown, headers: Record<string, string> = {}) =>
    fetch(`${getBaseUrl()}/api/experiments/${slug}/comparison`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });

  const authHeaders = () => ({ "X-Auth-Token": project.apiKey });

  beforeAll(async () => {
    project = await getTestProject("comparison-cli-test");

    agent = await prisma.agent.create({
      data: {
        projectId: project.id,
        name: "Test Code Agent",
        type: "code",
        config: {
          parameters: [{ identifier: "code", type: "code", value: "" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
        },
      },
    });

    experiment = await prisma.experiment.create({
      data: {
        projectId: project.id,
        name: "Comparison CLI Test",
        slug: testSlug,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: {
          experimentSlug: testSlug,
          name: "Comparison CLI Test",
          datasets: [
            {
              id: "dataset-1",
              name: "Test Dataset",
              type: "inline",
              inline: {
                columns: [
                  { id: "input", name: "input", type: "string" },
                  { id: "expected_output", name: "expected_output", type: "string" },
                ],
                records: {
                  input: ["hello"],
                  expected_output: ["world"],
                },
              },
              columns: [
                { id: "input", name: "input", type: "string" },
                { id: "expected_output", name: "expected_output", type: "string" },
              ],
            },
          ],
          activeDatasetId: "dataset-1",
          targets: [
            {
              id: "target-a",
              type: "prompt",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
              mappings: {
                "dataset-1": {
                  input: {
                    type: "source",
                    source: "dataset",
                    sourceId: "dataset-1",
                    sourceField: "input",
                  },
                },
              },
              localPromptConfig: {
                llm: { model: "openai/gpt-4o-mini" },
                messages: [{ role: "user", content: "{{input}}" }],
                inputs: [{ identifier: "input", type: "str" }],
                outputs: [{ identifier: "output", type: "str" }],
              },
            },
            {
              id: "target-b",
              type: "prompt",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
              mappings: {
                "dataset-1": {
                  input: {
                    type: "source",
                    source: "dataset",
                    sourceId: "dataset-1",
                    sourceField: "input",
                  },
                },
              },
              localPromptConfig: {
                llm: { model: "openai/gpt-4o-mini" },
                messages: [{ role: "user", content: "{{input}}" }],
                inputs: [{ identifier: "input", type: "str" }],
                outputs: [{ identifier: "output", type: "str" }],
              },
            },
          ],
          evaluators: [],
        },
      },
    });
  });

  afterAll(async () => {
    if (experiment) {
      await prisma.experiment.delete({ where: { id: experiment.id, projectId: project.id } });
    }
    if (agent) {
      await prisma.agent.delete({ where: { id: agent.id, projectId: project.id } });
    }
  });

  describe("authentication", () => {
    it("returns 401 when no API key provided", async () => {
      const response = await post(testSlug, {
        variants: [
          { kind: "existingTarget", targetId: "target-a" },
          { kind: "existingTarget", targetId: "target-b" },
        ],
      });

      expect(response.status).toBe(401);
    });
  });

  describe("experiment lookup", () => {
    it("returns 404 for a non-existent experiment", async () => {
      const response = await post(
        "non-existent-slug",
        {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
        },
        authHeaders(),
      );

      expect(response.status).toBe(404);
    });
  });

  describe("validation", () => {
    it("rejects fewer than two variants", async () => {
      const response = await post(
        testSlug,
        { variants: [{ kind: "existingTarget", targetId: "target-a" }] },
        authHeaders(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/at least two variants/i);
    });

    it("returns the current target ids when an existingTarget reference is unknown", async () => {
      const response = await post(
        testSlug,
        {
          variants: [
            { kind: "existingTarget", targetId: "does-not-exist" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
        },
        authHeaders(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toContain("target-a");
      expect(body.error).toContain("target-b");
    });
  });

  describe("attaching a comparison to existing targets", () => {
    it("adds one comparison target referencing both existing targets, without duplicating them", async () => {
      const response = await post(
        testSlug,
        {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
          goldenField: "expected_output",
        },
        authHeaders(),
      );

      expect(response.status).toBe(200);
      const body = await response.json();
      expect(body.comparisonTargetId).toBeDefined();
      expect(body.createdTargetIds).toEqual([]);
      expect(body.targets).toHaveLength(3);

      const comparisonTarget = body.targets.find(
        (t: { id: string }) => t.id === body.comparisonTargetId,
      );
      expect(comparisonTarget.type).toBe("evaluator");
      expect(comparisonTarget.comparison.variants.sort()).toEqual([
        "target-a",
        "target-b",
      ]);
    });
  });

  describe("attaching a comparison that creates missing variant targets", () => {
    it("creates an agent target inline and reuses it on a second call", async () => {
      const firstResponse = await post(
        testSlug,
        {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "agent", agentId: agent.id },
          ],
        },
        authHeaders(),
      );

      expect(firstResponse.status).toBe(200);
      const firstBody = await firstResponse.json();
      expect(firstBody.createdTargetIds).toHaveLength(1);
      const createdAgentTargetId = firstBody.createdTargetIds[0];

      const secondResponse = await post(
        testSlug,
        {
          variants: [
            { kind: "existingTarget", targetId: "target-b" },
            { kind: "agent", agentId: agent.id },
          ],
        },
        authHeaders(),
      );

      expect(secondResponse.status).toBe(200);
      const secondBody = await secondResponse.json();
      // The agent target created by the first call is reused, not duplicated.
      expect(secondBody.createdTargetIds).toEqual([]);
      expect(secondBody.reusedTargetIds).toContain(createdAgentTargetId);
    });
  });

  describe("rejecting a comparison-of-comparisons", () => {
    it("rejects a variant that is itself a comparison target", async () => {
      const setupResponse = await post(
        testSlug,
        {
          variants: [
            { kind: "existingTarget", targetId: "target-a" },
            { kind: "existingTarget", targetId: "target-b" },
          ],
        },
        authHeaders(),
      );
      const { comparisonTargetId } = await setupResponse.json();

      const response = await post(
        testSlug,
        {
          variants: [
            { kind: "existingTarget", targetId: comparisonTargetId },
            { kind: "existingTarget", targetId: "target-a" },
          ],
        },
        authHeaders(),
      );

      expect(response.status).toBe(400);
      const body = await response.json();
      expect(body.error).toMatch(/comparison/i);
    });
  });
});
