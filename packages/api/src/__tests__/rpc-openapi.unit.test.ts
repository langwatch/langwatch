import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createTestService as createService } from "./test-service.js";

// ---------------------------------------------------------------------------
// An RPC endpoint has to reach the published document exactly like a REST one.
//
// The trap: hono-openapi's `excludeStaticFile` defaults to TRUE, and its filter
// is `!excludeStaticFile || !path.includes(".") || path.includes("{")`. Every
// RPC name is dotted and parameterless, so on the default an entire family
// generates ZERO paths — `generateSpecs` returns `{}`, the spec task exits 0,
// and the merge publishes nothing. Nothing throws. A host generating a spec
// for a service with RPC endpoints MUST pass `excludeStaticFile: false`.
// ---------------------------------------------------------------------------

const RPC_SPEC_OPTIONS = { excludeStaticFile: false } as const;

function buildRpcService() {
  return createService({ name: "things", basePath: "/api/things" })
    .register(
      "things.create",
      "2026-08-07",
      async (_c, input: { name: string }) => input,
      (b) =>
        b
          .withInput(z.object({ name: z.string() }))
          .withOutput(z.object({ name: z.string() }))
          .withDocs({
            operationId: "createThing",
            tags: ["Things"],
            description: "Create a thing",
          }),
    )
    .build();
}

describe("RPC OpenAPI generation", () => {
  describe("given an RPC endpoint declaring docs", () => {
    it("publishes it at every dated version plus latest, never a bare path", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      const paths = Object.keys(spec.paths ?? {});
      expect(paths.filter((p) => p.includes("things.create")).sort()).toEqual([
        "/api/things/2026-08-07/things.create",
        "/api/things/latest/things.create",
      ]);
    });

    it("publishes it as a POST carrying its operationId", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      const operation = (
        spec.paths as Record<string, Record<string, { operationId?: string }>>
      )["/api/things/2026-08-07/things.create"]?.post;

      expect(operation?.operationId).toBe("createThing");
    });

    it("documents the request body the RPC arguments travel in", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      const operation = (
        spec.paths as Record<string, Record<string, { requestBody?: unknown }>>
      )["/api/things/2026-08-07/things.create"]?.post;

      expect(operation?.requestBody).toBeDefined();
    });
  });

  /**
   * The trap itself, pinned. If a future hono-openapi stops treating a dotted
   * path as a static asset this test fails, which is the signal that hosts no
   * longer need the option — not a regression. Until then it documents why
   * every RPC host must pass it, in a form that cannot rot.
   */
  describe("given the generator runs with its default options", () => {
    it("drops every RPC path as if it were a static file", async () => {
      const spec = await generateSpecs(buildRpcService());

      expect(Object.keys(spec.paths ?? {})).toEqual([]);
    });
  });
});
