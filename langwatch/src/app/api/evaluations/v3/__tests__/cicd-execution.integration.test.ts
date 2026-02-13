import type { Experiment, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { runStateManager } from "~/server/evaluations-v3/execution/runStateManager";
import { getTestProject, isServiceReachable } from "~/utils/testUtils";

/**
 * Integration tests for CI/CD Evaluation Execution endpoints.
 * Requires:
 * - LangWatch dev server running on localhost:5560
 * - LANGWATCH_NLP_SERVICE running on localhost:5561
 * - OPENAI_API_KEY in environment
 * - Redis available (for run state)
 * - Database available for test project
 */
const cicdBaseUrl = process.env.TEST_BASE_URL ?? "http://localhost:5560";
const cicdServerReachable = await isServiceReachable(cicdBaseUrl);

describe.skipIf(!cicdServerReachable)("CI/CD Evaluation Execution API", () => {
  let project: Project;
  let experiment: Experiment;
  const testSlug = `ci-cd-test-${Date.now()}`;

  beforeAll(async () => {
    project = await getTestProject("cicd-execution-test");

    // Create a test experiment with Evaluations V3 state
    experiment = await prisma.experiment.create({
      data: {
        projectId: project.id,
        name: "CI/CD Test Evaluation",
        slug: testSlug,
        type: ExperimentType.EVALUATIONS_V3,
        workbenchState: {
          experimentId: undefined,
          experimentSlug: testSlug,
          name: "CI/CD Test Evaluation",
          datasets: [
            {
              id: "dataset-1",
              name: "Test Dataset",
              type: "inline",
              inline: {
                columns: [
                  { id: "question", name: "question", type: "string" },
                  { id: "expected", name: "expected", type: "string" },
                ],
                records: {
                  question: ["Say hello", "Say world"],
                  expected: ["hello", "world"],
                },
              },
              columns: [
                { id: "question", name: "question", type: "string" },
                { id: "expected", name: "expected", type: "string" },
              ],
            },
          ],
          activeDatasetId: "dataset-1",
          targets: [
            {
              id: "target-1",
              type: "prompt",
              name: "GPT-4o Mini",
              inputs: [{ identifier: "input", type: "str" }],
              outputs: [{ identifier: "output", type: "str" }],
              mappings: {
                "dataset-1": {
                  input: {
                    type: "source",
                    source: "dataset",
                    sourceId: "dataset-1",
                    sourceField: "question",
                  },
                },
              },
              localPromptConfig: {
                llm: {
                  model: "openai/gpt-4o-mini",
                  temperature: 0,
                  maxTokens: 50,
                },
                messages: [
                  {
                    role: "system",
                    content:
                      "You are a helpful assistant. Respond with only the exact word requested.",
                  },
                  { role: "user", content: "{{input}}" },
                ],
                inputs: [{ identifier: "input", type: "str" }],
                outputs: [{ identifier: "output", type: "str" }],
              },
            },
          ],
          evaluators: [
            {
              id: "eval-1",
              evaluatorType: "langevals/exact_match",
              name: "Exact Match",
              settings: {},
              inputs: [
                { identifier: "output", type: "str" },
                { identifier: "expected_output", type: "str" },
              ],
              mappings: {
                "dataset-1": {
                  "target-1": {
                    output: {
                      type: "source",
                      source: "target",
                      sourceId: "target-1",
                      sourceField: "output",
                    },
                    expected_output: {
                      type: "source",
                      source: "dataset",
                      sourceId: "dataset-1",
                      sourceField: "expected",
                    },
                  },
                },
              },
            },
          ],
        },
      },
    });
  });

  afterAll(async () => {
    // Clean up
    if (experiment) {
      await prisma.experiment.delete({
        where: { id: experiment.id, projectId: project.id },
      });
    }
  });

  const getBaseUrl = () => {
    return process.env.TEST_BASE_URL ?? "http://localhost:5560";
  };

  describe("POST /api/evaluations/v3/:slug/run", () => {
    describe("authentication", () => {
      it("returns 401 when no API key provided", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
          },
        );

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toContain("Missing API key");
      });

      it("returns 401 with invalid API key", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": "invalid-api-key",
            },
          },
        );

        expect(response.status).toBe(401);
        const body = await response.json();
        expect(body.error).toContain("Invalid API key");
      });

      it("accepts X-Auth-Token header for authentication", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        // Should get past authentication
        expect(response.status).not.toBe(401);
      });

      it("accepts Authorization Bearer header for authentication", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${project.apiKey}`,
            },
          },
        );

        // Should get past authentication
        expect(response.status).not.toBe(401);
      });
    });

    describe("evaluation lookup", () => {
      it("returns 404 for non-existent evaluation", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/non-existent-slug/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        expect(response.status).toBe(404);
        const body = await response.json();
        expect(body.error).toContain("not found");
      });
    });

    describe("polling mode (default)", () => {
      it("returns runId immediately for polling", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        expect(response.status).toBe(200);
        const body = await response.json();
        expect(body.runId).toBeDefined();
        expect(body.status).toBe("running");
        expect(body.total).toBe(2); // 2 dataset rows × 1 target
        expect(body.runUrl).toContain(testSlug);
      }, 30000);
    });

    describe("SSE mode", () => {
      it("streams events with Accept: text/event-stream", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": project.apiKey,
              Accept: "text/event-stream",
            },
          },
        );

        expect(response.status).toBe(200);
        expect(response.headers.get("content-type")).toContain(
          "text/event-stream",
        );

        // Read stream events
        const reader = response.body?.getReader();
        const decoder = new TextDecoder();
        const events: string[] = [];
        let done = false;

        while (!done && reader) {
          const { value, done: readerDone } = await reader.read();
          done = readerDone;
          if (value) {
            const text = decoder.decode(value);
            events.push(text);

            // Stop after receiving done event
            if (text.includes('"type":"done"')) {
              break;
            }
          }
        }

        // Verify we received events
        expect(events.length).toBeGreaterThan(0);

        // Parse and check event types
        const eventData = events
          .join("")
          .split("data: ")
          .filter((e) => e.trim())
          .map((e) => {
            try {
              return JSON.parse(e.split("\n")[0]!);
            } catch {
              return null;
            }
          })
          .filter(Boolean);

        // Should have execution_started, progress, and done events
        const eventTypes = eventData.map((e: { type: string }) => e.type);
        expect(eventTypes).toContain("execution_started");
        expect(eventTypes).toContain("done");
      }, 120000);
    });
  });

  describe("GET /api/evaluations/v3/runs/:runId", () => {
    describe("authentication", () => {
      it("returns 401 when no API key provided", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs/some-run-id`,
          {
            method: "GET",
          },
        );

        expect(response.status).toBe(401);
      });
    });

    describe("run status", () => {
      it("returns 404 for non-existent run", async () => {
        const response = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs/non-existent-run`,
          {
            method: "GET",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        expect(response.status).toBe(404);
      });

      it("returns run status for valid runId", async () => {
        // First start a run
        const startResponse = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        expect(startResponse.status).toBe(200);
        const { runId } = await startResponse.json();

        // Poll for status
        const statusResponse = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/runs/${runId}`,
          {
            method: "GET",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        expect(statusResponse.status).toBe(200);
        const body = await statusResponse.json();
        expect(body.runId).toBe(runId);
        expect(["pending", "running", "completed", "failed"]).toContain(
          body.status,
        );
        expect(body.total).toBe(2);
      }, 30000);

      it("returns summary when run completes", async () => {
        // Start a run
        const startResponse = await fetch(
          `${getBaseUrl()}/api/evaluations/v3/${testSlug}/run`,
          {
            method: "POST",
            headers: {
              "X-Auth-Token": project.apiKey,
            },
          },
        );

        const { runId } = await startResponse.json();

        // Poll until complete (max 60 seconds)
        let status = "running";
        let summary = null;
        const startTime = Date.now();

        while (status === "running" || status === "pending") {
          if (Date.now() - startTime > 60000) {
            throw new Error("Run did not complete within timeout");
          }

          await new Promise((resolve) => setTimeout(resolve, 2000));

          const statusResponse = await fetch(
            `${getBaseUrl()}/api/evaluations/v3/runs/${runId}`,
            {
              method: "GET",
              headers: {
                "X-Auth-Token": project.apiKey,
              },
            },
          );

          const body = await statusResponse.json();
          status = body.status;
          summary = body.summary;
        }

        expect(status).toBe("completed");
        expect(summary).toBeDefined();
        expect(summary.runId).toBe(runId);
        expect(summary.totalCells).toBe(2);
      }, 120000);
    });
  });

  describe("run state manager", () => {
    it("creates and retrieves run state", async () => {
      const runId = `test-run-${Date.now()}`;

      await runStateManager.createRun({
        runId,
        projectId: project.id,
        experimentSlug: testSlug,
        total: 10,
      });

      const state = await runStateManager.getRunState(runId);

      expect(state).not.toBeNull();
      expect(state?.runId).toBe(runId);
      expect(state?.status).toBe("running");
      expect(state?.total).toBe(10);

      // Clean up
      await runStateManager.deleteRun(runId);
    });

    it("updates progress", async () => {
      const runId = `test-run-${Date.now()}`;

      await runStateManager.createRun({
        runId,
        projectId: project.id,
        experimentSlug: testSlug,
        total: 10,
      });

      await runStateManager.updateProgress(runId, 5);

      const state = await runStateManager.getRunState(runId);
      expect(state?.progress).toBe(5);

      // Clean up
      await runStateManager.deleteRun(runId);
    });

    it("completes run with summary", async () => {
      const runId = `test-run-${Date.now()}`;

      await runStateManager.createRun({
        runId,
        projectId: project.id,
        experimentSlug: testSlug,
        total: 10,
      });

      await runStateManager.completeRun(runId, {
        runId,
        totalCells: 10,
        completedCells: 10,
        failedCells: 0,
        duration: 5000,
        timestamps: { startedAt: Date.now() - 5000, finishedAt: Date.now() },
      });

      const state = await runStateManager.getRunState(runId);
      expect(state?.status).toBe("completed");
      expect(state?.summary).toBeDefined();
      expect(state?.finishedAt).toBeDefined();

      // Clean up
      await runStateManager.deleteRun(runId);
    });

    it("fails run with error", async () => {
      const runId = `test-run-${Date.now()}`;

      await runStateManager.createRun({
        runId,
        projectId: project.id,
        experimentSlug: testSlug,
        total: 10,
      });

      await runStateManager.failRun(runId, "Test error message");

      const state = await runStateManager.getRunState(runId);
      expect(state?.status).toBe("failed");
      expect(state?.error).toBe("Test error message");

      // Clean up
      await runStateManager.deleteRun(runId);
    });
  });
});
