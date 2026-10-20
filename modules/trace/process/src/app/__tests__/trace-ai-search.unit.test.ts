/**
 * @vitest-environment node
 * Ask AI on the trace module: the project's `traces.ai_search` model answers,
 * and a process composed without a model refuses by name.
 * @see modules/trace/specs/trace-ai-search.feature
 */
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceAppDependencies } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const PROJECT_ID = "project-1";
const ASK = {
  projectId: PROJECT_ID,
  authorization: ownProof({ projectId: PROJECT_ID }),
  prompt: "traces with errors",
  timeRange: { from: 1_000, to: 2_000 },
};

function facetList() {
  return createApiFixture<TraceAppDependencies["traces"]["list"]>({
    getFacetValues: async () => ({ values: [{ value: "error", count: 4 }], totalDistinct: 1 }),
  });
}

describe("given a trace module with the project's AI search model", () => {
  /** @scenario "Ask AI answers a query the explorer applies" */
  it("answers the model's query to apply, asked on the traces.ai_search feature", async () => {
    const generateStructured = vi.fn<ModelProviderApi["generateStructured"]>(async () => ({
      kind: "apply_query",
      query: "status:error",
    }));
    const app = createTraceAppHarness({
      models: createApiFixture<ModelProviderApi>({ generateStructured }),
      traces: { list: facetList() },
    });

    await expect(app.aiAction(ASK)).resolves.toEqual({
      ok: true,
      kind: "apply_query",
      query: "status:error",
    });
    expect(generateStructured).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        featureKey: "traces.ai_search",
        prompt: "traces with errors",
      }),
    );
  });
});

describe("given a trace module composed with no model seam", () => {
  /** @scenario "A process composed without a model refuses AI search by name" */
  it("refuses Ask AI with service_unavailable", () => {
    const app = createTraceAppHarness({ traces: { list: facetList() } });

    expect(() => app.aiAction(ASK)).toThrow(
      expect.objectContaining({ code: "service_unavailable" }),
    );
  });
});
