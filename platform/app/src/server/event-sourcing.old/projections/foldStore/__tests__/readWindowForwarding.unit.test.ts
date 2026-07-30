import { describe, expect, it } from "vitest";
import { createTenantId } from "../../../domain/tenantId";
import { codingAgentSessionFoldStore } from "../../../pipelines/coding-agent-processing/projections/codingAgentSession.store";
import { evaluationAnalyticsFoldStore } from "../../../pipelines/evaluation-processing/projections/evaluationAnalytics.store";
import type { ProjectionStoreContext } from "../../projectionStoreContext";

/**
 * A declared read window that nothing carries is worse than no window: the fold
 * says its read is partition-pruned, the metrics say the window is working, and
 * the query scans every partition anyway. `RepositoryFoldStore` has exactly that
 * bug — it never forwards `context.readWindow`, so the window every adopter of
 * it declares is inert.
 *
 * `defineFoldStore` carries the window BY CONSTRUCTION: the store builds the
 * table query itself and the window is on it before any per-store code runs. All
 * a store binds is the repository's own method and its id parameter name. This
 * is the assertion that the last hop — that binding — does not drop it, run
 * against every real fold store rather than a stand-in.
 */

const WINDOW = { fromMs: 4_000, toMs: 5_000 };

const context: ProjectionStoreContext = {
  aggregateId: "agg-1",
  tenantId: createTenantId("tenant-1"),
  readWindow: WINDOW,
};

const stores = [
  {
    name: evaluationAnalyticsFoldStore.name,
    definition: evaluationAnalyticsFoldStore,
    method: "findByEvaluationIdWithApplied",
    keyParam: "evaluationId",
  },
  {
    name: codingAgentSessionFoldStore.name,
    definition: codingAgentSessionFoldStore,
    method: "findBySessionIdWithApplied",
    keyParam: "sessionId",
  },
] as const;

describe("read window forwarding", () => {
  for (const { name, definition, method, keyParam } of stores) {
    describe(`given the ${name} fold store`, () => {
      describe("when the executor supplies a read window", () => {
        it("reaches the repository with the window and the tenant-scoped key", async () => {
          let received: Record<string, unknown> | undefined;
          const repository = {
            [method]: async (params: Record<string, unknown>) => {
              received = params;
              return null;
            },
          };

          const store = new (
            definition.Store as unknown as new (
              repository: unknown,
            ) => {
              get(id: string, ctx: ProjectionStoreContext): Promise<unknown>;
            }
          )(repository);
          await store.get("agg-1", context);

          expect(received).toEqual({
            tenantId: "tenant-1",
            [keyParam]: "agg-1",
            window: WINDOW,
          });
        });
      });

      describe("when the executor supplies no read window", () => {
        it("leaves the read unbounded rather than inventing a width", async () => {
          let received: Record<string, unknown> | undefined;
          const repository = {
            [method]: async (params: Record<string, unknown>) => {
              received = params;
              return null;
            },
          };

          const store = new (
            definition.Store as unknown as new (
              repository: unknown,
            ) => {
              get(id: string, ctx: ProjectionStoreContext): Promise<unknown>;
            }
          )(repository);
          await store.get("agg-1", { ...context, readWindow: undefined });

          expect(received?.window).toBeUndefined();
        });
      });
    });
  }
});
