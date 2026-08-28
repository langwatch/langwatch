/**
 * Reads, at queue time, the models each run of a batch will run on.
 *
 * The chain lives in `run-models.ts`; this is the half that reaches the
 * database for it: the case's own model choice, and the project default for
 * each role. It runs once per batch, so one read of the cases and at most one
 * resolution per role covers every run.
 *
 * It never throws. A project with no model set for a role is a fault the
 * prefetch already reports with its own remediation message, and losing the
 * run at the queue over a record it keeps for the reader would be worse than
 * the record being absent.
 *
 * @see specs/scenarios/resolved-run-models-on-runs.feature
 */

import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "~/generated/prisma/client";
import { resolveModelForFeature } from "../modelProviders/resolveModelForFeature";
import {
  type ResolvedRunModels,
  type RunModelChoice,
  resolveRunModels,
} from "./run-models";

const logger = createLogger("langwatch:scenarios:run-models");

/** The models each named case will run on, keyed by case id. */
export type RunModelsResolver = (params: {
  projectId: string;
  scenarioIds: string[];
  /** What the run plan names, empty when it names nothing. */
  plan: RunModelChoice;
}) => Promise<Map<string, ResolvedRunModels>>;

export function createRunModelsResolver(
  prisma: PrismaClient,
): RunModelsResolver {
  return async ({ projectId, scenarioIds, plan }) => {
    const resolved = new Map<string, ResolvedRunModels>();
    if (scenarioIds.length === 0) return resolved;

    try {
      const scenarios = await prisma.scenario.findMany({
        where: { id: { in: scenarioIds }, projectId },
        select: { id: true, simulatorModel: true, judgeModel: true },
      });
      const choiceById = new Map(
        scenarios.map((scenario) => [
          scenario.id,
          {
            simulatorModel: scenario.simulatorModel,
            judgeModel: scenario.judgeModel,
          },
        ]),
      );

      // One project default per role for the whole batch: every case of it
      // asks the same question of the same project.
      const defaults = new Map<string, Promise<string>>();
      const resolveFeatureModel = (featureKey: string) => {
        const pending =
          defaults.get(featureKey) ??
          resolveModelForFeature(featureKey, { prisma, projectId }).then(
            (resolution) => resolution.model,
          );
        defaults.set(featureKey, pending);
        return pending;
      };

      for (const scenarioId of scenarioIds) {
        resolved.set(
          scenarioId,
          await resolveRunModels({
            plan,
            scenario: choiceById.get(scenarioId) ?? {},
            resolveFeatureModel,
          }),
        );
      }
    } catch (error) {
      logger.warn(
        { error, projectId },
        "Could not resolve the models for the queued runs; they record none",
      );
      return new Map();
    }

    return resolved;
  };
}
