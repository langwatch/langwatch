/**
 * Shared parts of the prompt-optimization bootstrap suites: the scenario
 * shape they all run, the seed they all start from, and the Layer-2 check that
 * an evaluator really resolves rather than merely existing.
 */

import { openai } from "@ai-sdk/openai";
import * as scenario from "@langwatch/scenario";
import { expect } from "vitest";
import { makeLangyAdapter } from "./langy-agent";
import { runScenarioAndLog } from "./scenario-logger";
import {
  type GoldenStyle,
  type SavedEvaluator,
  type SavedFieldMapping,
  seedOptimizationWorkbench,
} from "./seed-optimization-workbench";

const model = openai("gpt-5-mini");

/** Every bootstrap scenario runs Langy against a simulator and a judge. */
export async function runBootstrapScenario({
  name,
  description,
  slug,
  script,
  criteria,
}: {
  name: string;
  description: string;
  slug: string;
  script: Parameters<typeof scenario.run>[0]["script"];
  criteria: string[];
}) {
  return runScenarioAndLog({
    config: {
      name,
      description: `${description} The experiment's slug is "${slug}".`,
      agents: [
        makeLangyAdapter(),
        scenario.userSimulatorAgent({ model }),
        scenario.judgeAgent({ model, criteria }),
      ],
      script,
    },
  });
}

/** The bootstrap precondition: a workbench with no evaluator on it yet. */
export async function seedWithoutEvaluator({
  name,
  rows,
  goldenStyle,
  withContexts = false,
}: {
  name: string;
  rows: number;
  goldenStyle: GoldenStyle;
  withContexts?: boolean;
}) {
  return seedOptimizationWorkbench({
    name,
    rows,
    goldenStyle,
    withEvaluator: false,
    withContexts,
  });
}

/** Where one evaluator input has to read from for its wiring to resolve. */
export type ExpectedSource =
  | { from: "dataset"; column: string }
  | { from: "target"; output: string };

/**
 * Assert that an evaluator of the wanted type landed AND resolves every input
 * it needs on the seeded column.
 *
 * The type on its own is not the outcome these scenarios describe: an
 * evaluator whose inputs point nowhere scores no row, so it passes a
 * type-only check while measuring nothing.
 */
export function expectEvaluatorWiring({
  evaluators,
  datasetId,
  targetId,
  isWanted,
  wiring,
  what,
}: {
  evaluators: SavedEvaluator[];
  datasetId: string;
  targetId: string;
  isWanted: (evaluatorType: string) => boolean;
  wiring: Record<string, ExpectedSource>;
  what: string;
}): void {
  const wired = evaluators
    .filter((evaluator) => isWanted(evaluator.evaluatorType))
    .find((evaluator) =>
      Object.entries(wiring).every(([field, expected]) =>
        resolves({
          mapping: evaluator.mappings?.[datasetId]?.[targetId]?.[field],
          expected,
          datasetId,
          targetId,
        }),
      ),
    );
  const found = evaluators.map((evaluator) => ({
    evaluatorType: evaluator.evaluatorType,
    mappings: evaluator.mappings?.[datasetId]?.[targetId],
  }));
  expect(
    wired,
    `${what}. Evaluators on the experiment: ${JSON.stringify(found)}`,
  ).toBeDefined();
}

function resolves({
  mapping,
  expected,
  datasetId,
  targetId,
}: {
  mapping: SavedFieldMapping | undefined;
  expected: ExpectedSource;
  datasetId: string;
  targetId: string;
}): boolean {
  if (mapping?.type !== "source") return false;
  if (expected.from === "dataset") {
    return (
      mapping.source === "dataset" &&
      mapping.sourceId === datasetId &&
      mapping.sourceField === expected.column
    );
  }
  return (
    mapping.source === "target" &&
    mapping.sourceId === targetId &&
    mapping.sourceField === expected.output
  );
}
