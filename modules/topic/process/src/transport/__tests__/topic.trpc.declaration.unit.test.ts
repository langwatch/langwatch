/**
 * The topic tRPC wire, pinned: every procedure name, its kind, and the
 * permission the server binds to it — a rename here is a cache-key change
 * in every browser that calls it (transport-declaration-split.feature).
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { topicTrpc } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";

import { topicTrpcTransport } from "../topic.trpc.ts";

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

const DECLARATION_SOURCES = ["contract/src/topic.trpc.ts", "process/src/transport/topic.trpc.ts"];

describe("the topic tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    /** @scenario "The server repeats nothing the contract said" */
    it("keeps the topic wire names, kinds and permissions", () => {
      const table = Object.entries(topicTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissionsOf(topicTrpcTransport)[index],
      ]);

      expect(table).toEqual([
        ["getAll", "query", "traces:view"],
        ["getClusteringStatus", "query", "project:view"],
        ["getClusteringRunHistory", "query", "project:view"],
      ]);
    });

    /** @scenario "The server repeats nothing the contract said" */
    it("declares an output for every procedure that answers with data", () => {
      const answering = Object.entries(topicTrpc.members)
        .filter(([, member]) => member.output !== undefined)
        .map(([name]) => name);

      expect(answering).toHaveLength(Object.keys(topicTrpc.members).length);
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
      for (const specifier of valueImports(sourceOf("contract/src/topic.trpc.ts"))) {
        expect([specifier, "contract/src/topic.trpc.ts"]).toEqual([
          expect.stringMatching(/^(?:zod|@langwatch\/api\/contract|\.\/)/),
          "contract/src/topic.trpc.ts",
        ]);
      }
    });

    /** @scenario "A process mounts a declaration on the runtime it built" */
    it("value-imports no runtime from the contract or the server declarations", () => {
      const runtimes = /@langwatch\/api\/(?:rest|trpc)"[\s\S]*?createRestRuntime|createTrpcRuntime/;

      for (const relative of DECLARATION_SOURCES) {
        expect(sourceOf(relative), relative).not.toMatch(runtimes);
      }
    });
  });
});
