/**
 * Pins, from the installed declarations, every REST route a legacy project key scope flag opens,
 * and that every flag a route names is one the door knows.
 * @vitest-environment node
 * @see modules/auth/specs/legacy-project-key-scope.feature
 */
import { LEGACY_PROJECT_KEY_SCOPE_FLAGS } from "@langwatch/api-key-contract";
import type { RestTransportDeclaration } from "@langwatch/api/rest";
import { describe, expect, it } from "vitest";

import { processModules } from "../process-modules.generated.ts";

/** `METHOD /namespace/path` for every installed route, under each scope flag it names. */
function routesByScope(): Record<string, string[]> {
  const byScope: Record<string, string[]> = {};
  for (const module of processModules) {
    for (const transport of module.transports ?? []) {
      if (transport.protocol !== "rest") continue;
      const declaration = transport.router() as RestTransportDeclaration<unknown>;
      for (const route of declaration.routes) {
        for (const scope of route.legacyKeyScopes ?? []) {
          (byScope[scope] ??= []).push(
            `${route.method.toUpperCase()} ${declaration.namespace} ${route.path}`,
          );
        }
      }
    }
  }
  for (const routes of Object.values(byScope)) routes.sort();

  return byScope;
}

describe("the routes each legacy project key scope flag opens", () => {
  it("names only scope flags the door knows", () => {
    expect(
      Object.keys(routesByScope()).filter(
        (scope) => !(LEGACY_PROJECT_KEY_SCOPE_FLAGS as readonly string[]).includes(scope),
      ),
    ).toEqual([]);
  });

  it("is exactly the pinned list", () => {
    expect(routesByScope()).toMatchInlineSnapshot(`
      {
        "legacy_project_key_annotations_read": [
          "GET annotations /",
          "GET annotations /:id",
          "GET annotations /trace/:id",
        ],
        "legacy_project_key_connected_agents": [
          "GET agents /connect/poll",
          "GET model-providers /",
          "POST agents /connect/frames",
          "POST agents /connect/register",
        ],
        "legacy_project_key_evaluations": [
          "GET evaluators /",
          "GET evaluators /:evaluatorId/versions",
          "GET evaluators /:idOrSlug",
          "POST evaluations-legacy /api/evaluations/:evaluator/:subpath/evaluate",
          "POST evaluations-legacy /api/evaluations/:evaluator/evaluate",
          "POST evaluations-legacy /api/guardrails/:evaluator/evaluate",
        ],
        "legacy_project_key_experiments": [
          "GET dataset /",
          "GET dataset /:datasetSlug/entries",
          "GET dataset /:slugOrId",
          "GET dataset /:slugOrId/records",
          "GET evaluations /:evaluationSlug/versions",
          "GET evaluations /:evaluationSlug/workbench-state",
          "GET evaluations /runs",
          "GET evaluations /runs/:runId",
          "GET evaluations /runs/:runId/results",
          "GET experiments /",
          "GET experiments /:slug",
          "GET experiments /:slug/versions",
          "GET experiments /:slug/workbench-state",
          "GET experiments /runs",
          "GET experiments /runs/:runId",
          "GET experiments /runs/:runId/results",
          "POST dataset-evaluation /api/dataset/evaluate",
          "POST dspy /log_steps",
          "POST evaluations /:evaluationSlug/run",
          "POST evaluations /:evaluationSlug/versions/:version/restore",
          "POST evaluations /api/evaluations/batch/log_results",
          "POST evaluations-legacy /api/evaluations/:evaluator/:subpath/evaluate",
          "POST evaluations-legacy /api/evaluations/:evaluator/evaluate",
          "POST experiment /init",
          "POST experiments /",
          "POST experiments /:slug/run",
          "POST experiments /:slug/versions/:version/restore",
          "POST workflows /:id/evaluate",
          "PUT evaluations /:evaluationSlug/workbench-state",
          "PUT experiments /:slug/workbench-state",
        ],
        "legacy_project_key_prompts_read": [
          "GET prompts /api/prompts",
          "GET prompts /api/prompts/:id{.+?}/versions",
          "GET prompts /api/prompts/:id{.+}",
          "GET prompts /api/prompts/tags",
        ],
        "legacy_project_key_prompts_write": [
          "POST prompts /api/prompts",
          "POST prompts /api/prompts/:id{.+?}/sync",
          "POST prompts /api/prompts/:id{.+?}/versions/:versionId/restore",
          "POST prompts /api/prompts/tags",
          "PUT prompts /api/prompts/:id{.+?}/tags/:tag",
          "PUT prompts /api/prompts/:id{.+}",
          "PUT prompts /api/prompts/tags/:tag",
        ],
        "legacy_project_key_scenarios": [
          "GET simulation-runs /",
          "GET simulation-runs /:scenarioRunId",
          "GET simulation-runs /batches/:batchRunId",
          "GET simulation-runs /batches/list",
          "POST scenario-events /",
          "POST scenario-events /browser-tab",
        ],
        "legacy_project_key_traces_read": [
          "GET trace-legacy /api/thread/:threadId",
          "GET trace-legacy /api/trace/:id",
          "GET traces /:traceId",
          "GET traces /:traceId/transcript",
          "GET traces /facets",
          "POST trace-legacy /api/trace/search",
          "POST traces /search",
        ],
      }
    `);
  });
});
