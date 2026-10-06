/**
 * A JSON array body (E1), mounted on the real REST runtime: validated as sent, handed under the
 * field its route names, and published as the array itself. Spec:
 * packages/api/specs/transport-conventions.feature.
 */
import { moduleApi } from "@langwatch/module";
import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

const VERSION = "2026-10-05";
const JSON_TYPE = { "content-type": "application/json" };

interface StepsApi {
  logSteps(input: unknown): Promise<{ logged: number }>;
}

const StepsApi = moduleApi<StepsApi>()("experiment");

function stepsApp() {
  const handed: unknown[] = [];
  const router = defineRestRouter(StepsApi)
    .withNamespace("steps")
    .withVersion(VERSION)
    .withCredential("project")
    .post("/:runId", "logSteps")
    .withParams(z.object({ runId: z.string() }))
    .withQuery(z.object({ dryRun: z.enum(["yes", "no"]).optional() }))
    .withInput(z.array(z.object({ index: z.number(), label: z.string() })), { as: "steps" })
    .withPermission("experiments:manage")
    .withOutput(z.object({ logged: z.number() }))
    .handle(({ input }) => {
      handed.push(input);

      return { logged: input.steps.length };
    })
    .build()
    .router();

  const app = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "api_key", id: "key-1" },
        scope: { tier: "project", id: "project-1" },
      }),
    },
  }).mount(router, {
    app: () => ({ logSteps: async () => ({ logged: 0 }) }),
    onError: createErrorHandler(),
  });

  return { app, handed };
}

const STEPS = [
  { index: 0, label: "start" },
  { index: 1, label: "end" },
];

describe("a route whose JSON input is an array handed under one field", () => {
  describe("when called with an array whose items match", () => {
    /** @scenario "An array body is validated as sent and handed under the field its route names" */
    it("hands the handler the array under that field, beside the path and query fields", async () => {
      const { app, handed } = stepsApp();

      const response = await app.request(`/api/steps/${VERSION}/run-1?dryRun=no`, {
        method: "POST",
        headers: JSON_TYPE,
        body: JSON.stringify(STEPS),
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ logged: 2 });
      expect(handed).toEqual([{ runId: "run-1", dryRun: "no", steps: STEPS }]);
    });
  });

  describe("when the body is broken, absent or refused by the schema", () => {
    /** @scenario "An array body is validated as sent and handed under the field its route names" */
    it.each([
      ["malformed JSON", "[", 400, "malformed_request"],
      ["an absent body", undefined, 400, "malformed_request"],
      ["an item the schema refuses", JSON.stringify([{ index: "zero" }]), 422, "validation_error"],
      ["an object instead of an array", JSON.stringify({ steps: STEPS }), 422, "validation_error"],
    ])("refuses %s before the handler", async (_label, body, status, code) => {
      const { app, handed } = stepsApp();

      const response = await app.request(`/api/steps/${VERSION}/run-1`, {
        method: "POST",
        headers: JSON_TYPE,
        ...(body === undefined ? {} : { body }),
      });

      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code });
      expect(handed).toEqual([]);
    });
  });

  describe("when the document is generated", () => {
    /** @scenario "An array body is validated as sent and handed under the field its route names" */
    it("publishes the array itself as the required request body", async () => {
      const published = await generateSpecs(stepsApp().app, { excludeStaticFile: false });
      const [operation] = Object.entries(published.paths ?? {})
        .filter(([path]) => path.includes("/steps/"))
        .map(([, item]) => (item as { post?: { requestBody?: unknown } }).post);

      expect(operation?.requestBody).toMatchObject({
        required: true,
        content: { "application/json": { schema: { type: "array" } } },
      });
    });
  });
});
