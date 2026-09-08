/**
 * The evaluator tRPC wire, pinned: every procedure name, its kind and the
 * permission the server binds to it. A rename here is a cache-key change in
 * every browser that calls it.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { evaluatorTrpc } from "@langwatch/evaluator-contract";
import { describe, expect, it } from "vitest";

import { evaluatorTrpcTransport } from "../evaluator.trpc.ts";

const featureRoot = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

/** Mounts a declaration and records the access each procedure asked for. */
function permissionsOf(declaration: {
  router: TrpcRouterMount<never, never>;
}): (AuthzPermission | object)[] {
  const declared: (AuthzPermission | object)[] = [];

  const runtime: TrpcProcedureFactory<object> = {
    procedure: ({ access }) => {
      declared.push(access.kind === "permission" ? access.permission : access);

      return {};
    },
    router: (record) => record,
  };

  (declaration.router as unknown as (factory: TrpcProcedureFactory<object>, app: unknown) => void)(
    runtime,
    () => {
      throw new Error("the wire table never resolves an application");
    },
  );

  return declared;
}

function sourceOf(relative: string): string {
  const path = join(featureRoot, relative);
  expect(existsSync(path), `${path} is a declaration this guard reads; it moved`).toBe(true);

  return readFileSync(path, "utf8");
}

/** Every `import`/`export … from` that is not erased at build time. */
function valueImports(source: string): string[] {
  return [...source.matchAll(/^(?:import|export)\s+(?!type\s)[^;]*?from\s+"([^"]+)";/gm)].map(
    (match) => match[1]!,
  );
}

const DECLARATION_SOURCES = [
  "contract/src/evaluator.trpc.ts",
  "server/src/transport/evaluator.trpc.ts",
  "server/src/transport/evaluator.rest.ts",
];

describe("the evaluator tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    /** @scenario "The server repeats nothing the contract said" */
    it("keeps the evaluators wire names, kinds and permissions", () => {
      const table = Object.entries(evaluatorTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissionsOf(evaluatorTrpcTransport)[index],
      ]);

      expect(table).toEqual([
        ["getAll", "query", "evaluations:view"],
        ["getById", "query", "evaluations:view"],
        ["getBySlug", "query", "evaluations:view"],
        ["create", "mutation", "evaluations:manage"],
        ["update", "mutation", "evaluations:manage"],
        ["getRelatedEntities", "query", "evaluations:view"],
        ["cascadeArchive", "mutation", "evaluations:manage"],
        ["delete", "mutation", "evaluations:manage"],
        ["getWorkflowFields", "query", "evaluations:view"],
        ["getCopies", "query", "evaluations:view"],
        ["copy", "mutation", "evaluations:manage"],
        ["pushToCopies", "mutation", "evaluations:manage"],
        ["syncFromSource", "mutation", "evaluations:manage"],
        ["getHistory", "query", "evaluations:view"],
      ]);
    });

    /** @scenario "The server repeats nothing the contract said" */
    it("declares an output for every procedure that answers with data", () => {
      const answering = Object.entries(evaluatorTrpc.members)
        .filter(([, member]) => member.output !== void 0)
        .map(([name]) => name);

      expect(answering).toHaveLength(Object.keys(evaluatorTrpc.members).length);
    });
  });

  describe("given the feature's declaration sources are read", () => {
    /** @scenario "A feature declaration carries no process generics" */
    it("names no process context, root, options or mount type", () => {
      const offending = /\b(TContext|TRoot|TOptions|TrpcApiMount|AnyTRPCRootTypes|AppRouter)\b/;

      for (const relative of DECLARATION_SOURCES) {
        expect(sourceOf(relative), relative).not.toMatch(offending);
      }
    });

    /** @scenario "A contract declares a procedure once, in a browser-safe module" */
    it("value-imports only zod, the contract entry and its own schemas", () => {
      for (const specifier of valueImports(sourceOf("contract/src/evaluator.trpc.ts"))) {
        expect(specifier).toMatch(/^(?:zod|@langwatch\/api\/contract|\.\/)/);
      }
    });

    /** @scenario "A process mounts a declaration on the runtime it built" */
    it("value-imports no runtime from the contract or the server declarations", () => {
      const runtimes = /createRestRuntime|createTrpcRuntime/;

      for (const relative of DECLARATION_SOURCES) {
        expect(sourceOf(relative), relative).not.toMatch(runtimes);
      }
    });
  });
});
