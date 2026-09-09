/**
 * The boot cross-check: no route reaches the router unclassified, and the
 * router's own 405 answer for a declared path is not mistaken for one.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { moduleApi } from "@langwatch/runtime-composition";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createErrorHandler } from "../../errors.ts";
import { defineRestRouter } from "../declaration.ts";
import { createRestRuntime } from "../runtime.ts";
import { allRegisteredRoutes, assertEveryRouteDeclared, undeclaredRoutes } from "../security.ts";

const SecretApi = moduleApi<{ getById(input: { id: string }): Promise<{ id: string }> }>("secret");

const secrets = defineRestRouter(SecretApi)
  .withNamespace("secrets")
  .withVersion("2026-09-08")
  .get("/:id", "getDeclaredSecret")
  .withParams(z.object({ id: z.string() }))
  .withPermission("secrets:view")
  .withOutput(z.object({ id: z.string() }))
  .handle(async ({ app, input }) => app.getById({ id: input.id }))
  .build();

function mounted(): Hono {
  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({ actor: null, scope: { tier: "project", id: "project-1" } as const }),
    },
  });

  return runtime.mount(secrets.router(), {
    app: () => ({ getById: async ({ id }: { id: string }) => ({ id }) }),
    onError: createErrorHandler(),
  });
}

describe("the cross-check a process boots behind", () => {
  describe("given a family the runtime mounted", () => {
    /** @scenario "A process mounts a declaration on the runtime it built" */
    it("finds every address declared, the router's own 405 guards among them", () => {
      const app = mounted();

      expect(undeclaredRoutes({ app, registry: allRegisteredRoutes() })).toEqual([]);
      expect(() =>
        assertEveryRouteDeclared({ app, registry: allRegisteredRoutes() }),
      ).not.toThrow();
    });
  });

  describe("given a route mounted outside the runtime", () => {
    /** @scenario "A process mounts a declaration on the runtime it built" */
    it("refuses to finish booting, naming the address nothing declared", () => {
      const app = mounted();

      app.get("/api/secrets/smuggled", (context) => context.json({}));

      expect(undeclaredRoutes({ app, registry: allRegisteredRoutes() })).toEqual([
        "GET /api/secrets/smuggled",
      ]);
      expect(() => assertEveryRouteDeclared({ app, registry: allRegisteredRoutes() })).toThrow(
        /no declared access policy: GET \/api\/secrets\/smuggled/,
      );
    });
  });
});
