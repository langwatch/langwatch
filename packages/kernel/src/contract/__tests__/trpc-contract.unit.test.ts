/**
 * The declaration a contract module makes, and the one thing that keeps it usable from a browser:
 * what it imports. Spec: packages/api/specs/transport-declaration-split.feature.
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
      expect(contract.members.getById?.output?.validate({ id: "a" })).toBe(true);
      expect(contract.members.deleteById?.output).toBeUndefined();
      expect(contract.members.deleteById?.input.validate({ id: "a" })).toBe(true);
    });

    /** @scenario "A contract declares a procedure once, in a browser-safe module" */
    it("reaches no server framework, tRPC runtime or Node API from its own module", () => {
      // Every file this surface offers, and each one a leaf. A module contract
      // is imported by every browser that installs it, so one server import
      // here is `node:async_hooks` in the browser bundle — which is what
      // `defineRestMiddleware` living in rest/request.ts actually did.
      expect(valueImports(sourceOf("trpc-contract.ts"))).toEqual(["./versioned-answer.ts"]);
      expect(valueImports(sourceOf("versioned-answer.ts"))).toEqual(["zod"]);
      expect(valueImports(sourceOf("rest-middleware.ts"))).toEqual([]);
      expect(valueImports(sourceOf("ui-tokens.ts"))).toEqual([]);
      expect(valueImports(sourceOf("release-flags.ts"))).toEqual([]);

      expect(valueImports(sourceOf("index.ts"))).toEqual([
        "./trpc-contract.ts",
        "./rest-middleware.ts",
        "./ui-tokens.ts",
        "./release-flags.ts",
      ]);
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

describe("defineTrpcContract cache policy", () => {
  describe("given a read declared with a cache tier and one declared without", () => {
    const contract = defineTrpcContract("organization")
      .query("getAll", { cache: { tier: "session", persist: true } })
      .withInput(z.object({}))
      .withOutput(z.array(z.string()))

      .query("getMemberById")
      .withInput(z.object({ id: z.string() }))
      .build();

    it("carries the declared policy on the member", () => {
      expect(contract.members.getAll.cache).toEqual({ tier: "session", persist: true });
    });

    it("leaves an undeclared read without one", () => {
      expect("cache" in contract.members.getMemberById).toBe(false);
    });
  });
});

describe("defineTrpcContract versioned read", () => {
  const contract = defineTrpcContract("organization")
    .query("getScopeGraph", { cache: { tier: "session", persist: true, versioned: true } })
    .withInput(z.object({}))
    .withOutput(z.array(z.string()))
    .build();

  const member = contract.members.getScopeGraph;

  /** @scenario "A contract declares a versioned read once, with its envelope" */
  it("adds an optional since to the input and wraps the answer in the envelope", () => {
    expect(member.input.validate({})).toBe(true);
    expect(member.input.validate({ since: "v1" })).toBe(true);
    expect(member.input.validate({ since: 7 })).toBe(false);

    expect(member.output.validate({ unchanged: true })).toBe(true);
    expect(member.output.validate({ version: "v1", data: ["a"] })).toBe(true);
    expect(member.output.validate({ version: "v1", data: [1] })).toBe(false);
    expect(member.output.validate(["a"])).toBe(false);
  });

  /** @scenario "A contract declares a versioned read once, with its envelope" */
  it("carries the versioned cache policy and the answer it wraps", () => {
    expect(member.cache).toEqual({ tier: "session", persist: true, versioned: true });
    expect(member.answer.validate(["a"])).toBe(true);
  });

  /** @scenario "A contract declares a versioned read once, with its envelope" */
  it("refuses a versioned read that already declares since", () => {
    const declared = () =>
      defineTrpcContract("organization")
        .query("getScopeGraph", { cache: { tier: "session", versioned: true } })
        .withInput(z.object({ since: z.string() }));

    expect(declared).toThrow(/adds "since" to its input/);
  });
});
