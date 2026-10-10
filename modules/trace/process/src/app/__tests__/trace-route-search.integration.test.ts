/**
 * A sentence the browser brings without Instant Eval's classification, routed
 * by a real TraceModule: the model decides and builds, and the judgement route
 * stays closed unless the browser says it is open.
 * @see specs/traces-v2/instant-eval-search.feature
 */
import type { Authorization } from "@langwatch/authorization";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { RouteSearchInput } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import type { TracesListReader } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const RANGE = { from: 1_000_000, to: 1_000_000 + 24 * 3_600_000 };

/** A model that answers every routing call with a judgement. */
function judgingModel() {
  const generateStructured = vi.fn(async () => ({
    route: "instant_eval",
    instructions: "Does the user sound frustrated?",
    yes: "Complains or repeats",
    no: "Stays neutral",
  }));
  const models = createApiFixture<Pick<ModelProviderApi, "generateText" | "generateStructured">>(
    { generateStructured },
    "models",
  );
  return { models, generateStructured };
}

/** A project with no facet values yet: no known evaluators, events or field values. */
const emptyProject = {
  list: createApiFixture<TracesListReader>(
    { getFacetValues: async () => ({ values: [], totalDistinct: 0 }) },
    "list",
  ),
};

function submit(
  overrides: Partial<RouteSearchInput> = {},
): RouteSearchInput & { authorization: Authorization } {
  return {
    projectId: "project-1",
    authorization: ownProof({ projectId: "project-1" }),
    text: "frustrated users",
    timeRange: RANGE,
    activeQuery: "",
    ...overrides,
  };
}

describe("given the browser brings no classification", () => {
  describe("when the user submits a sentence", () => {
    /** @scenario "A missing classification falls back as it does today" */
    it("lets the model decide and build, with Instant Evals unavailable", async () => {
      const { models, generateStructured } = judgingModel();
      const app = createTraceAppHarness({ models, traces: emptyProject });

      const result = await app.routeSearch(submit());

      expect(generateStructured).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        kind: "free_text",
        query: '"frustrated users"',
        decidedBy: "model",
      });
    });

    it("opens the judgement route when the browser says Instant Evals are available", async () => {
      const { models } = judgingModel();
      const app = createTraceAppHarness({ models, traces: emptyProject });

      const result = await app.routeSearch(submit({ isInstantEvalAvailable: true }));

      expect(result).toMatchObject({
        kind: "instant_eval",
        question: {
          instructions: "Does the user sound frustrated?",
          criteria: ["Complains or repeats", "Stays neutral"],
        },
        decidedBy: "model",
      });
    });
  });
});
