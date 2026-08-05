import type { Agent, Experiment, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { getTestProject } from "~/utils/testUtils";

/**
 * Integration tests for POST /api/experiments/:slug/comparison.
 *
 * @see specs/experiments-v3/cli-comparison-target.feature
 *
 * Requires the app running at TEST_BASE_URL (default http://localhost:5560).
 * Mirrors the harness conventions in cicd-execution.integration.test.ts.
 *
 * Refusals are asserted on `error`, which the REST boundary fills with the
 * handled error's CODE. The prose in `message` is copy and will be reworded;
 * the code is what a caller branches on.
 */
describe.skipIf(process.env.CI)(
  "POST /api/experiments/:slug/comparison",
  () => {
    let project: Project;
    let experiment: Experiment;
    let agent: Agent;
    const testSlug = `comparison-cli-test-${Date.now()}`;

    const getBaseUrl = () =>
      process.env.TEST_BASE_URL ?? "http://localhost:5560";

    const post = (
      slug: string,
      body: unknown,
      headers: Record<string, string> = {},
    ) =>
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
                    {
                      id: "expected_output",
                      name: "expected_output",
                      type: "string",
                    },
                  ],
                  records: {
                    input: ["hello"],
                    expected_output: ["world"],
                  },
                },
                columns: [
                  { id: "input", name: "input", type: "string" },
                  {
                    id: "expected_output",
                    name: "expected_output",
                    type: "string",
                  },
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
                  llm: { model: "openai/gpt-5-mini" },
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
                  llm: { model: "openai/gpt-5-mini" },
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
        await prisma.experiment.delete({
          where: { id: experiment.id, projectId: project.id },
        });
      }
      if (agent) {
        await prisma.agent.delete({
          where: { id: agent.id, projectId: project.id },
        });
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

        // The `min(2)` bound lives on the request schema, so this is refused at
        // the validator with the field named rather than deeper in the service.
        expect(response.status).toBe(422);
        const body = await response.json();
        expect(body.error).toBe("validation_error");
        expect(body.fields).toContain("variants");
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
        expect(body.error).toBe("comparison_variant_target_not_found");
        expect(body.availableTargets.map((t: { id: string }) => t.id)).toEqual(
          expect.arrayContaining(["target-a", "target-b"]),
        );
      });

      it("rejects a goldenField that isn't a real dataset column", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-b" },
            ],
            goldenField: "not-a-real-column",
          },
          authHeaders(),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("comparison_field_not_in_dataset");
        expect(body.availableColumns).toContain("expected_output");
      });
    });

    describe("attaching a comparison to existing targets", () => {
      /** @scenario "A comparison attached over the API is persisted on the experiment" */
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
        // Asserted as a delta, not an absolute count: every case in this file
        // writes to the same experiment, so a total would encode the order the
        // blocks happen to run in.
        expect(body.createdTargetIds).toEqual([]);

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
        // Asserted before the id is read: a failed setup would otherwise send
        // `targetId: undefined` below and fail the schema instead of the case
        // this block is about.
        expect(setupResponse.status).toBe(200);
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
        expect(body.error).toBe("comparison_variant_is_comparison");
      });
    });

    describe("rejecting variants that resolve to the same target", () => {
      it("rejects a duplicate existingTarget reference", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "existingTarget", targetId: "target-a" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(400);
        const body = await response.json();
        expect(body.error).toBe("comparison_variants_not_distinct");
      });
    });

    describe("referencing an agent that does not exist", () => {
      it("returns a 404 rather than a generic failure", async () => {
        const response = await post(
          testSlug,
          {
            variants: [
              { kind: "existingTarget", targetId: "target-a" },
              { kind: "agent", agentId: "does-not-exist" },
            ],
          },
          authHeaders(),
        );

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toBe("comparison_variant_agent_not_found");
        expect(body.agentId).toBe("does-not-exist");
      });
    });

    describe("malformed request body", () => {
      it("returns 400 for invalid JSON", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/experiments/${testSlug}/comparison`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: "{not valid json",
          },
        );

        expect(response.status).toBe(400);
      });

      it("returns 422 when variants is missing", async () => {
        const response = await post(testSlug, {}, authHeaders());

        expect(response.status).toBe(422);
      });
    });
  },
);
