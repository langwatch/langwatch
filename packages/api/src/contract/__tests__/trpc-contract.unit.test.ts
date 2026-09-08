/**
 * The declaration a contract module makes, and the one thing that keeps it
 * usable from a browser: what it imports.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { defineTrpcContract } from "../trpc-contract.ts";

const contractRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

function sourceOf(name: string): string {
  const path = join(contractRoot, name);

  expect(existsSync(path), `${path} is the contract entry this guard reads; it moved`).toBe(true);

  return readFileSync(path, "utf8");
}

/** Every `import`/`export … from` that is not erased at build time. */
function valueImports(source: string): string[] {
  return [...source.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gm)].map(
    (match) => match[1]!,
  );
}

describe("defineTrpcContract", () => {
  describe("given a query with an input and an output and a mutation with only an input", () => {
    const contract = defineTrpcContract("annotation")
      .query("getById")
      .withInput(z.object({ id: z.string() }))
      .withOutput(z.object({ id: z.string() }))

      .mutation("deleteById")
      .withInput(z.object({ id: z.string() }))
      .build();

    /** @scenario "A contract declares a procedure once, in a browser-safe module" */
    it("carries the namespace, the names, the kinds and the schemas", () => {
      expect(contract.namespace).toBe("annotation");
      expect(Object.keys(contract.members)).toEqual(["getById", "deleteById"]);
      expect(contract.members.getById?.kind).toBe("query");
      expect(contract.members.deleteById?.kind).toBe("mutation");
      expect(contract.members.getById?.output?.safeParse({ id: "a" }).success).toBe(true);
      expect(contract.members.deleteById?.output).toBeUndefined();
      expect(contract.members.deleteById?.input.safeParse({ id: "a" }).success).toBe(true);
    });

    /** @scenario "A contract declares a procedure once, in a browser-safe module" */
    it("reaches no server framework, tRPC runtime or Node API from its own module", () => {
      expect(valueImports(sourceOf("trpc-contract.ts"))).toEqual([]);

      expect(valueImports(sourceOf("index.ts"))).toEqual(["./trpc-contract.ts"]);
    });
  });

  describe("given the same name is declared twice", () => {
    it("refuses the second declaration by name", () => {
      const twice = () =>
        defineTrpcContract("annotation")
          .query("getById")
          .withInput(z.object({ id: z.string() }))

          .mutation("getById" as never)
          .withInput(z.object({ id: z.string() }));

      expect(twice).toThrow(/declares procedure "getById" twice/);
    });
  });
});
