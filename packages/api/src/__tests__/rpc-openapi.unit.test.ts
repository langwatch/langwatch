import { generateSpecs } from "hono-openapi";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { createService } from "../builder.js";

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
    .version("2026-08-07", (v) => {
      v.rpc(
        "/things.create",
        { noPermission: { reason: "framework test endpoint" },
          input: z.object({ name: z.string() }),
          output: z.object({ name: z.string() }),
          status: 201,
          description: "Create a thing",
          docs: { operationId: "createThing", tags: ["Things"] },
        },
        async (_c, { input }) => input,
      );
    })
    .build();
}

describe("v.rpc OpenAPI generation", () => {
  describe("given an RPC endpoint declaring docs", () => {
    it("publishes it at the bare alias path", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      expect(Object.keys(spec.paths ?? {})).toContain(
        "/api/things/things.create",
      );
    });

    it("publishes it as a POST carrying its operationId", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      const operation = (
        spec.paths as Record<string, Record<string, { operationId?: string }>>
      )["/api/things/things.create"]?.post;

      expect(operation?.operationId).toBe("createThing");
    });

    it("documents the request body the RPC arguments travel in", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      const operation = (
        spec.paths as Record<
          string,
          Record<string, { requestBody?: unknown }>
        >
      )["/api/things/things.create"]?.post;

      expect(operation?.requestBody).toBeDefined();
    });

    it("publishes the bare alias only, never the dated or latest mounts", async () => {
      const spec = await generateSpecs(buildRpcService(), RPC_SPEC_OPTIONS);

      const paths = Object.keys(spec.paths ?? {});

      expect(paths.filter((p) => p.includes("things.create"))).toEqual([
        "/api/things/things.create",
      ]);
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
