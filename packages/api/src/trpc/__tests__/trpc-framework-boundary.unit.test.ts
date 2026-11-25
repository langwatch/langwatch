/**
 * @vitest-environment node
 * The framework's own boundary: what a root keeps concrete, what a procedure must declare
 * before it can run, and which entry points a consumer may import.
 */
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod";

import { defineTrpcRouter, TrpcRootDefinition } from "../runtime.ts";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function productionSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "__tests__" ? [] : productionSources(path);
    return /\.tsx?$/.test(entry.name) && !entry.name.includes(".test.") ? [path] : [];
  });
}

interface ReviewApi {
  read(input: { id: string }): { id: string };
}

const ReviewApi = moduleApi<ReviewApi>()("annotation");

describe("a tRPC root", () => {
  describe("given a context and a procedure input", () => {
    /** @scenario "A root preserves concrete transport types" */
    it("answers a router caller with the concrete context, input and output, and imports no feature", async () => {
      const root = TrpcRootDefinition.forContext<{ actor: { id: string } }>().create({});
      const router = root.router({
        project: root.procedure
          .input(z.object({ projectId: z.string() }))
          .query(({ ctx, input }) => ({ actorId: ctx.actor.id, projectId: input.projectId })),
      });
      const response = router.createCaller({ actor: { id: "actor-1" } }).project({
        projectId: "project-1",
      });

      expectTypeOf(response).resolves.toEqualTypeOf<{ actorId: string; projectId: string }>();
      await expect(response).resolves.toEqual({ actorId: "actor-1", projectId: "project-1" });

      const imported = productionSources(join(packageRoot, "src", "trpc")).flatMap((file) =>
        [...readFileSync(file, "utf8").matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map(
          (match) => match[1] ?? "",
        ),
      );
      const featureImports = imported.filter((specifier) =>
        /^@langwatch\/(?:platform-api|worker|ui|enterprise.*|.+-(?:contract|process|browser|client))(?:\/|$)/.test(
          specifier,
        ),
      );
      expect(featureImports).toEqual([]);
    });
  });
});

describe("a tRPC procedure", () => {
  describe("given its input is declared and no authorization is", () => {
    /** @scenario "A procedure cannot be built without an authorization declaration" */
    it("offers no handler to build until a permission, opt-out or in-service decision is declared", () => {
      const contract = defineTrpcContract("review")
        .query("getById")
        .withInput(z.object({ projectId: z.string(), id: z.string() }))
        .withOutput(z.object({ id: z.string() }))
        .build();
      const undeclared = defineTrpcRouter(ReviewApi, contract).procedure("getById");

      expect("handle" in undeclared).toBe(false);
      // @ts-expect-error a procedure with no access decision has no handle to call
      expect(undeclared.handle).toBeUndefined();

      const declared = undeclared.withPermission("annotations:view");
      expect(typeof declared.handle).toBe("function");
    });
  });
});

describe("the @langwatch/api package", () => {
  describe("given its export map", () => {
    /** @scenario "Consumers import only the sealed public API" */
    it("exposes named entry points only, each a package index or one declared module", () => {
      const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")) as {
        exports: Record<string, { default: string } | string>;
      };
      const entries = Object.entries(manifest.exports);

      expect(entries.length).toBeGreaterThan(0);
      for (const [name, target] of entries) {
        expect(name).not.toContain("*");
        const file = typeof target === "string" ? target : target.default;
        expect(file).toMatch(/^\.\/src\/(?:[a-z-]+\/)*[a-z-]+\.ts$/);
      }
      expect(manifest.exports["."]).toBeDefined();
    });
  });
});
