import type { Agent, Experiment, Project } from "@prisma/client";
import { ExperimentType } from "@prisma/client";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { getTestProject } from "~/utils/testUtils";

/**
 * The live-HTTP harness the comparison route suites share: an experiment with
 * two prompt targets and a code agent, plus the request helper.
 *
 * Each suite mints its OWN experiment through `createComparisonFixture`, so the
 * two files never share a mutable row. Every request in a suite persists, and a
 * shared row would put one file's assertions at the mercy of the other file's
 * execution order.
 */

export type ComparisonFixture = {
  project: Project;
  experiment: Experiment;
  agent: Agent;
  slug: string;
};

export const comparisonBaseUrl = (): string =>
  process.env.TEST_BASE_URL ?? "http://localhost:5560";

export const postComparison = ({
  slug,
  body,
  headers = {},
}: {
  slug: string;
  body: unknown;
  headers?: Record<string, string>;
}): Promise<Response> =>
  fetch(`${comparisonBaseUrl()}/api/experiments/${slug}/comparison`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });

export const authHeadersFor = (fixture: ComparisonFixture) => ({
  "X-Auth-Token": fixture.project.apiKey,
});

export const createComparisonFixture = async (
  namespace: string,
): Promise<ComparisonFixture> => {
  const project = await getTestProject("comparison-cli-test");
  const testSlug = `${namespace}-${Date.now()}`;

  const agent = await prisma.agent.create({
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

  const experiment = await prisma.experiment.create({
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

  return { project, experiment, agent, slug: testSlug };
};

export const cleanupComparisonFixture = (fixture: ComparisonFixture) =>
  cleanupTestRows(prisma, [
    [
      "experiment",
      { id: fixture.experiment.id, projectId: fixture.project.id },
    ],
    ["agent", { id: fixture.agent.id, projectId: fixture.project.id }],
  ]);
