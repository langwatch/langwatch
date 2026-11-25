import { describe, expect, it, vi } from "vitest";

import type { LangwatchApiClient } from "@/internal/api/client";

import { EvaluatorsApiService } from "../evaluators-api.service";

const ok = (data: unknown) => ({ data, error: undefined, response: new Response(null) });

function serviceWithClient() {
  const client = {
    GET: vi.fn(async () => ok({ id: "evaluator_1", name: "Toxicity", data: [] })),
    PUT: vi.fn(async () => ok({ label: "production", version: 2, versionId: "v2" })),
    DELETE: vi.fn(async () => ok({ label: "production", removed: true })),
  };
  const service = new EvaluatorsApiService({
    langwatchApiClient: client as unknown as LangwatchApiClient,
  });
  return { client, service };
}

describe("the evaluators service and versions", () => {
  /** @scenario "The TypeScript SDK reads an evaluator at a label and moves its labels" */
  it("sends the label or version on get and calls the versions and labels routes", async () => {
    const { client, service } = serviceWithClient();

    await service.get("evaluator_1", { label: "production" });
    await service.get("evaluator_1", { version: 2 });
    await service.listVersions("evaluator_1");
    await service.assignLabel("evaluator_1", "production", 2);
    await service.removeLabel("evaluator_1", "production");

    expect(client.GET.mock.calls).toEqual([
      [
        "/api/v1/evaluators/{idOrSlug}",
        { params: { path: { idOrSlug: "evaluator_1" }, query: { label: "production" } } },
      ],
      [
        "/api/v1/evaluators/{idOrSlug}",
        { params: { path: { idOrSlug: "evaluator_1" }, query: { version: 2 } } },
      ],
      [
        "/api/v1/evaluators/{evaluatorId}/versions",
        { params: { path: { evaluatorId: "evaluator_1" } } },
      ],
    ]);
    expect(client.PUT).toHaveBeenCalledWith("/api/v1/evaluators/{evaluatorId}/labels/{label}", {
      params: { path: { evaluatorId: "evaluator_1", label: "production" } },
      body: { version: 2 },
    });
    expect(client.DELETE).toHaveBeenCalledWith("/api/v1/evaluators/{evaluatorId}/labels/{label}", {
      params: { path: { evaluatorId: "evaluator_1", label: "production" } },
    });
  });
});
