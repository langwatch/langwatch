/**
 * The legacy evaluation family, mounted directly through `mountEvaluationsLegacyRest`
 * over a fixture `EvaluationApi` rather than through the whole door registry: the
 * declaration itself is the single source of which paths and permissions this
 * family answers, and the module's own suite already covers the twelve routes.
 */
// @vitest-environment node
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountEvaluationsLegacyRest } from "../evaluations-legacy-rest.mount.ts";

const PROJECT_ID = "project-evaluations-legacy";

function mountEvaluations(evaluations: Partial<EvaluationApi>) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;
  const runtime = createApiRestRuntime({
    projectCredential: async () => ({
      ok: true as const,
      project: { id: PROJECT_ID },
      resolved: {
        type: "apiKey" as const,
        apiKeyId: "key-evaluations-legacy",
        userId: null,
        organizationId: "organization-evaluations-legacy",
        ingestSourceType: null,
        ingestionTemplateId: null,
        project: {
          id: PROJECT_ID,
          name: "Evaluations Legacy",
          slug: "evaluations-legacy",
          teamId: "team-evaluations-legacy",
          organizationId: "organization-evaluations-legacy",
          isPersonal: false,
          ownerUserId: null,
        },
      },
      markUsed: () => void 0,
    }),
    organizationCredential: () => {
      throw new Error("This suite opens no organization credential door");
    },
    organizationIdentity: () => {
      throw new Error("This suite opens no organization credential door");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors,
  });
  const app = createApiFixture<EvaluationApi>(evaluations, "EvaluationApi");
  const mounted = mountEvaluationsLegacyRest(runtime, () => app);

  return {
    fetch: (path: string, init?: RequestInit) =>
      mounted.fetch(new Request(`http://api.test${path}`, init)),
  };
}

describe("given the evaluator catalogue this process compiles in", () => {
  describe("when a caller with no credential reads it", () => {
    it("answers 200 with no credential asked", async () => {
      const world = mountEvaluations({});

      const response = await world.fetch("/api/evaluations/list");

      expect(response.status).toBe(200);
    });
  });
});

describe("given a project credential on the legacy family", () => {
  describe("when an SDK posts batch evaluation rows", () => {
    it("reaches the composed EvaluationApi's logBatchEvaluation", async () => {
      let received: unknown;
      const world = mountEvaluations({
        logBatchEvaluation: async (input) => {
          received = input;
        },
      });

      const response = await world.fetch("/api/evaluations/batch/log_results", {
        method: "POST",
        headers: { "content-type": "application/json", "x-auth-token": "token" },
        body: JSON.stringify({
          experiment_slug: "experiment-1",
          run_id: "run-1",
          dataset: [],
        }),
      });

      expect(response.status).toBe(200);
      expect(received).toBeDefined();
    });
  });
});
