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
      expect(valueImports(sourceOf("trpc-contract.ts"))).toEqual([]);
      expect(valueImports(sourceOf("rest-middleware.ts"))).toEqual([]);
      expect(valueImports(sourceOf("ui-tokens.ts"))).toEqual([]);
      expect(valueImports(sourceOf("release-flags.ts"))).toEqual([]);
      expect(valueImports(sourceOf("schema-hash.ts"))).toEqual(["zod"]);

      expect(valueImports(sourceOf("index.ts"))).toEqual([
        "./trpc-contract.ts",
        "./schema-hash.ts",
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
          .withOutput(z.unknown())

          .mutation("getById" as never)
          .withInput(z.object({ id: z.string() }));

      expect(twice).toThrow(/declares procedure "getById" twice/);
    });
  });
});

describe("given a query declared without an output", () => {
  /** @scenario "A query declared without an output is refused at build" */
  it("refuses to build, naming the query", () => {
    const declared = defineTrpcContract("annotation").query("getById").withInput(z.object({}));
    // @ts-expect-error a query owes its output, so the builder offers no build() before withOutput.
    const build = () => declared.build();

    expect(build).toThrow(/declares query "getById" without withOutput/);
  });

  /** @scenario "A query declared without an output is refused at build" */
  it("still builds a write declared without one", () => {
    const contract = defineTrpcContract("annotation")
      .mutation("remove")
      .withInput(z.object({ id: z.string() }))
      .build();

    expect(contract.members.remove.output).toBeUndefined();
  });
});

describe("defineTrpcContract cache policy", () => {
  describe("given a read declared with a cache policy and one declared without", () => {
    const contract = defineTrpcContract("organization")
      .query("getAll", { cache: { persist: true } })
      .withInput(z.object({}))
      .withOutput(z.array(z.string()))

      .query("getMemberById")
      .withInput(z.object({ id: z.string() }))
      .withOutput(z.string())
      .build();

    it("carries the declared policy on the member", () => {
      expect(contract.members.getAll.cache).toEqual({ persist: true });
    });

    it("leaves an undeclared read without one", () => {
      expect("cache" in contract.members.getMemberById).toBe(false);
    });
  });
});

describe("a read naming the events that make it stale", () => {
  const contract = defineTrpcContract("organization")
    .query("getScopeGraph", { invalidatedBy: ["lw.project.created"] })
    .withInput(z.object({}))
    .withOutput(z.array(z.string()))
    .query("getAll", {
      invalidatedBy: [
        { event: "lw.project.created", scope: "organizationId" },
        "lw.authz.grant.revoked",
      ],
    })
    .withInput(z.object({}))
    .withOutput(z.unknown())
    .query("getOrganizationWithMembers")
    .withInput(z.object({}))
    .withOutput(z.unknown())
    .build();

  /** @scenario "A read names the committed events that make it stale" */
  it("carries the events it named", () => {
    expect(contract.members.getScopeGraph.invalidatedBy).toEqual(["lw.project.created"]);
  });

  /** @scenario "A read names the event field its hint is scoped by" */
  it("carries a scoped event with the field its hint is read from", () => {
    expect(contract.members.getAll.invalidatedBy).toEqual([
      { event: "lw.project.created", scope: "organizationId" },
      "lw.authz.grant.revoked",
    ]);
  });

  /** @scenario "A read names the committed events that make it stale" */
  it("carries none on a read that names none", () => {
    expect("invalidatedBy" in contract.members.getOrganizationWithMembers).toBe(false);
  });
});

describe("a read naming the projections it is served from", () => {
  const contract = defineTrpcContract("runs")
    .query("get", { fromProjection: [{ projection: "runState", key: "runId" }] })
    .withInput(z.object({ projectId: z.string(), runId: z.string() }))
    .withOutput(z.unknown())
    .query("list", { fromProjection: ["runState"] })
    .withInput(z.object({ projectId: z.string() }))
    .withOutput(z.unknown())
    .query("count")
    .withInput(z.object({ projectId: z.string() }))
    .withOutput(z.number())
    .build();

  /** @scenario "A read declares the projections it is served from" */
  it("carries the projection with its key field, or without one for the tenant", () => {
    expect(contract.members.get.fromProjection).toEqual([{ projection: "runState", key: "runId" }]);
    expect(contract.members.list.fromProjection).toEqual(["runState"]);
  });

  /** @scenario "A read declares the projections it is served from" */
  it("leaves a read that declares none without projections", () => {
    expect("fromProjection" in contract.members.count).toBe(false);
  });
});
