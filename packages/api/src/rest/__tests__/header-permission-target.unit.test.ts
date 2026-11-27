/** @vitest-environment node */
/** A header that names no project is the caller's to fix (transport-conventions.feature). */
import { moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { authorizationPort } from "../../__tests__/api-double.ts";
import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";

type PlaygroundApi = { run(): Promise<{ ran: boolean }> };

const PlaygroundApi = moduleApi<PlaygroundApi>()("model-provider");

function mounted() {
  const run = vi.fn(async () => ({ ran: true }));
  const authorizeDoor = vi.fn(() => ({ permitted: true, organizationRole: "ADMIN" as const }));
  const routes = defineRestRouter(PlaygroundApi)
    .withNamespace("playground")
    .withVersion("2026-10-09")
    .withCredential("browser")
    .withAddressing("literal", { v1Twin: false })
    .post("/api/playground", "run")
    .keepsRecords()
    .withHeaders(z.object({ "x-project-id": z.string().nullable().optional() }))
    .withPermission("playground:view", {
      at: "header",
      param: "projectId",
      header: "x-project-id",
    })
    .withOutput(z.object({ ran: z.boolean() }))
    .withoutAudit("test route")
    .handle(({ app }) => app.run())
    .build()
    .router();
  const server = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("a browser route never authenticates a key");
      },
      identify: () => ({ actor: { type: "user", id: "user_1" }, scope: null }),
      authorize: authorizeDoor,
    },
    authorization: authorizationPort,
  }).mount(routes, { app: () => ({ run }), credential: "browser", onError: createErrorHandler() });

  return {
    run,
    authorizeDoor,
    response: server.request("/api/playground", { method: "POST" }),
  };
}

describe("a route that asks its permission at the project its header names", () => {
  describe("when the caller sends no such header", () => {
    /** @scenario "A header or body that names no project is the caller's 400, not a wiring 500" */
    it("refuses it 400 as a validation error", async () => {
      const response = await mounted().response;

      expect({ status: response.status, body: await response.json() }).toMatchObject({
        status: 400,
        body: { code: "validation_error" },
      });
    });

    /** @scenario "A header or body that names no project is the caller's 400, not a wiring 500" */
    it("asks no permission and never reaches the handler", async () => {
      const { run, authorizeDoor, response } = mounted();

      await response;
      expect([authorizeDoor.mock.calls, run.mock.calls]).toEqual([[], []]);
    });
  });
});
