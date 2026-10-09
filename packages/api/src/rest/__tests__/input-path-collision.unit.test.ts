import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { defineRestRouter } from "../declaration.ts";
import { canonicalErrorResponse } from "../response.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-10-09";
const JSON_TYPE = { "Content-Type": "application/json" };

interface ScoreApi {
  score(input: Record<string, unknown>): Promise<{ ok: boolean }>;
}

const ScoreApi = moduleApi<ScoreApi>()("evaluation");

const scores = defineRestRouter(ScoreApi)
  .withNamespace("scores")
  .withVersion(VERSION)
  .post("/:evaluator/evaluate", "scoreEvaluator")
  .withParams(z.object({ evaluator: z.string() }))
  .withInput(z.looseObject({}))
  .withPermission("annotations:manage")
  .withOutput(z.object({ ok: z.boolean() }))
  .handle(async ({ app, input }) => app.score(input))
  .build();

function scoresApp() {
  const score = vi.fn(async (_input: Record<string, unknown>) => ({ ok: true }));

  const app = createRestRuntime({
    authorization: authorizationPort,
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } as const }),
    },
  }).mount(scores.router(), {
    app: () => ({ score }),
    credential: "project",
    onError: canonicalErrorResponse,
  });

  return { app, score };
}

describe("a route whose JSON body passes undeclared fields through", () => {
  /** @scenario "A body field that repeats a path parameter is refused as a handled 400" */
  it("refuses a body key equal to a path parameter with 400 malformed_request", async () => {
    const { app, score } = scoresApp();
    const response = await app.request(`/api/scores/${VERSION}/exact_match/evaluate`, {
      method: "POST",
      headers: JSON_TYPE,
      body: JSON.stringify({ evaluator: "other", data: {} }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "malformed_request" });
    expect(score).not.toHaveBeenCalled();
  });

  /** @scenario "A body field that repeats a path parameter is refused as a handled 400" */
  it("hands the handler the path and body fields when no key repeats", async () => {
    const { app, score } = scoresApp();
    const response = await app.request(`/api/scores/${VERSION}/exact_match/evaluate`, {
      method: "POST",
      headers: JSON_TYPE,
      body: JSON.stringify({ data: { output: "a" } }),
    });

    expect(response.status).toBe(200);
    expect(score).toHaveBeenCalledWith({ evaluator: "exact_match", data: { output: "a" } });
  });
});
