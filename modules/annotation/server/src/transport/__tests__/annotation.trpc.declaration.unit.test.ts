/**
 * The annotation tRPC wire, pinned: every procedure name, its kind, the schema
 * pair the contract declares for it and the permission the server binds to it.
 * A rename here is a cache-key change in every browser that calls it.
 *
 * Spec: packages/api/specs/transport-declaration-split.feature.
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { annotationScoreTrpc, annotationTrpc } from "@langwatch/annotation-contract";
import type { TrpcProcedureFactory, TrpcRouterMount } from "@langwatch/api/trpc";
import { describe, expect, it } from "vitest";

import { annotationScoreTrpcTransport } from "../annotation-score.trpc.ts";
import { annotationTrpcTransport } from "../annotation.trpc.ts";

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
  "contract/src/annotation.trpc.ts",
  "contract/src/annotation-score.trpc.ts",
  "server/src/transport/annotation.trpc.ts",
  "server/src/transport/annotation-score.trpc.ts",
  "server/src/transport/annotation.rest.ts",
  "web/src/behavior/annotation-api.ts",
  "web/src/behavior/annotation-scores-api.ts",
];

describe("the annotation tRPC declaration", () => {
  describe("given the contract and the server it is bound to", () => {
    /** @scenario "The server repeats nothing the contract said" */
    it("keeps the annotation wire names, kinds and permissions", () => {
      const table = Object.entries(annotationTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissionsOf(annotationTrpcTransport)[index],
      ]);

      expect(table).toEqual([
        ["create", "mutation", "annotations:create"],
        ["updateByTraceId", "mutation", "annotations:update"],
        ["getByTraceId", "query", "annotations:view"],
        ["getByTraceIds", "query", "annotations:view"],
        ["getById", "query", "annotations:view"],
        ["deleteById", "mutation", "annotations:delete"],
        ["getAll", "query", "annotations:view"],
        ["createOrUpdateQueue", "mutation", "annotations:create"],
        ["getQueues", "query", "annotations:view"],
        ["getQueueItems", "query", "annotations:view"],
        ["getPendingItemsCount", "query", "annotations:view"],
        ["getAssignedItemsCount", "query", "annotations:view"],
        ["getQueueItemsCounts", "query", "annotations:view"],
        ["createQueueItem", "mutation", "annotations:create"],
        ["deleteQueueItems", "mutation", "annotations:update"],
        ["markQueueItemDone", "mutation", "annotations:update"],
        ["getQueueBySlugOrId", "query", "annotations:view"],
        ["getOptimizedAnnotationQueues", "query", "annotations:view"],
      ]);
    });

    /** @scenario "The server repeats nothing the contract said" */
    it("keeps the annotationScore wire names, kinds and permissions", () => {
      const table = Object.entries(annotationScoreTrpc.members).map(([name, member], index) => [
        name,
        member.kind,
        permissionsOf(annotationScoreTrpcTransport)[index],
      ]);

      expect(table).toEqual([
        ["upsert", "mutation", "annotations:manage"],
        ["getAll", "query", "annotations:view"],
        ["getAllActive", "query", "annotations:view"],
        ["getById", "query", "annotations:view"],
        ["toggle", "mutation", "annotations:update"],
        ["delete", "mutation", "annotations:delete"],
      ]);
    });

    /** @scenario "The server repeats nothing the contract said" */
    it("declares an output for every procedure that answers with data", () => {
      const answering = Object.entries(annotationTrpc.members)
        .filter(([, member]) => member.output !== undefined)
        .map(([name]) => name);

      expect(answering).toHaveLength(Object.keys(annotationTrpc.members).length);

      expect(
        annotationTrpc.members.getPendingItemsCount?.output?.safeParse({ count: 3 }).success,
      ).toBe(true);
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
      for (const relative of [
        "contract/src/annotation.trpc.ts",
        "contract/src/annotation-score.trpc.ts",
      ]) {
        for (const specifier of valueImports(sourceOf(relative))) {
          expect([specifier, relative]).toEqual([
            expect.stringMatching(/^(?:zod|@langwatch\/api\/contract|\.\/)/),
            relative,
          ]);
        }
      }
    });

    /** @scenario "A process mounts a declaration on the runtime it built" */
    it("value-imports no runtime from the contract or the server declarations", () => {
      const runtimes = /@langwatch\/api\/(?:rest|trpc)"[\s\S]*?createRestRuntime|createTrpcRuntime/;

      for (const relative of DECLARATION_SOURCES) {
        expect(sourceOf(relative), relative).not.toMatch(runtimes);
      }
    });

    /** @scenario "The browser derives its client from the contract" */
    it("writes no hand-rolled map for the namespaces the contract declares", () => {
      const web = sourceOf("web/src/behavior/annotation-api.ts");
      expect(web).toContain("ContractApiMap<typeof annotationTrpc>");
      expect(web).toContain("ContractApiMap<typeof annotationScoreTrpc>");
      expect(web).not.toMatch(/AnnotationApiMap/);

      expect(sourceOf("web/src/behavior/annotation-scores-api.ts")).not.toMatch(
        /AnnotationScoresApiMap/,
      );
    });
  });
});
