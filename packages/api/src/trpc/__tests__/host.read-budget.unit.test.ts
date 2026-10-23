/**
 * The read budget on tRPC: a query or export counts against the session that made it, under the
 * project its input names; a write is not counted. Spec: specs/security/read-rate-limits.feature.
 */
import {
  type AuthzDeclaredScopeId,
  type PermissionDecision,
  sealAuthorization,
} from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import type { Authorize } from "../../access/access.ts";
import type { TrpcAuditSink } from "../../hosting/api-door.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import type { RateLimiter } from "../../ports.ts";
import { ReadBudget, type ReadBudgetLimits } from "../../read-budget.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface RowsApi {
  listRows(input: { projectId: string }): Promise<{ rows: string[] }>;
  exportRows(input: { projectId: string }): Promise<{ rows: string[] }>;
  renameRow(input: { projectId: string }): Promise<{ renamed: boolean }>;
}

const RowsApi = moduleApi<RowsApi>()("trace");

const projectInput = z.object({ projectId: z.string() });
const rowsOutput = z.object({ rows: z.array(z.string()) });

const contract = defineTrpcContract("rows")
  .query("listRows")
  .withInput(projectInput)
  .withOutput(rowsOutput)

  .mutation("exportRows")
  .withInput(projectInput)
  .withOutput(rowsOutput)

  .mutation("renameRow")
  .withInput(projectInput)
  .withOutput(z.object({ renamed: z.boolean() }))
  .build();

const LIMITS: ReadBudgetLimits = {
  readsPerMinute: 2,
  rowsPerHour: 1_000,
  rowsPerDay: 5_000,
  exportsPerMinute: 1,
  exportsPerDay: 10,
  impersonationReadsPerMinute: 1,
  impersonationRowsPerDay: 100,
};

const ROWS = ["a", "b", "c"];

function served() {
  const used = new Map<string, number>();
  const counter: RateLimiter = {
    check: async (key, limit, cost = 1) => {
      const total = (used.get(key) ?? 0) + cost;
      used.set(key, total);
      const allowance = limit?.requests ?? Number.MAX_SAFE_INTEGER;
      return total <= allowance
        ? { allowed: true, used: total }
        : { allowed: false, used: total, retryAfterSeconds: limit?.seconds ?? 1 };
    },
  };
  const scopes: (AuthzDeclaredScopeId | null)[] = [];
  const quiet = () => {};
  const readBudget = ReadBudget.create({
    counter,
    limitsFor: async ({ scope }) => {
      scopes.push(scope);
      return { limits: LIMITS, organizationId: "organization-1" };
    },
    enforced: async () => true,
    logger: { info: quiet, warn: quiet, error: quiet },
  });
  const audit: TrpcAuditSink = { record: () => {} };
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: "ADMIN",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
    organizationOf: async () => "organization-1",
    projectKindOf: async () => "application",
    assertSecondFactor: async () => {},
    authorization: async () =>
      sealAuthorization({
        actor: { type: "user", id: "sam" },
        principal: { type: "user", id: "sam" },
        scope: { organizationId: "organization-1" },
        grants: [{ projectId: "project-1", permissions: ["traces:view"], via: [], kind: "own" }],
        expiresAt: Date.now() + 60_000,
        purpose: { kind: "route", route: "rows.listRows" },
      }),
  });
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz,
    audit,
    readBudget,
  });
  const handled: string[] = [];
  const app: RowsApi = {
    listRows: async () => {
      handled.push("listRows");
      return { rows: ROWS };
    },
    exportRows: async () => {
      handled.push("exportRows");
      return { rows: ROWS };
    },
    renameRow: async () => {
      handled.push("renameRow");
      return { renamed: true };
    },
  };
  trpc.mount(
    composeTrpcRouters("rows", [
      defineTrpcRouter(RowsApi, contract)
        .procedure("listRows")
        .withPermission("traces:view")
        .handle(({ app: rows, input }) => rows.listRows(input))

        .procedure("exportRows")
        .withPermission("traces:view")
        .handle(({ app: rows, input }) => rows.exportRows(input))

        .procedure("renameRow")
        .withPermission("traces:view")
        .handle(({ app: rows, input }) => rows.renameRow(input))
        .build(),
    ]),
    () => app,
  );

  /** One call through the host, as a browser makes it; answers the HTTP status. */
  const call = async ({ procedure, query }: { procedure: string; query: boolean }) => {
    const input = JSON.stringify({ projectId: "project-1" });
    const base = `http://api.test${TrpcHost.path}/rows.${procedure}`;
    const request = query
      ? new Request(`${base}?input=${encodeURIComponent(input)}`)
      : new Request(base, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: input,
        });
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => trpc.context({ request }),
    });
    return response.status;
  };

  return { call, used, scopes, handled };
}

describe("the tRPC read budget", () => {
  describe("when a signed-in person queries", () => {
    it("counts a read and the rows answered against their session, under the input's project", async () => {
      const { call, used, scopes } = served();

      expect(await call({ procedure: "listRows", query: true })).toBe(200);

      expect(used.get("read-budget:session:sam:reads-minute")).toBe(1);
      expect(scopes).toContainEqual({ tier: "project", id: "project-1" });
      await vi.waitFor(() => {
        expect(used.get("read-budget:session:sam:rows-hour")).toBe(ROWS.length);
      });
    });
  });

  describe("when a mutation exports", () => {
    it("counts it against the export allowance", async () => {
      const { call, used } = served();

      expect(await call({ procedure: "exportRows", query: false })).toBe(200);

      expect(used.get("read-budget:session:sam:exports-minute")).toBe(1);
      expect(used.has("read-budget:session:sam:reads-minute")).toBe(false);
    });
  });

  describe("when a mutation writes", () => {
    it("counts nothing", async () => {
      const { call, used } = served();

      expect(await call({ procedure: "renameRow", query: false })).toBe(200);

      expect([...used.keys()]).toEqual([]);
    });
  });

  describe("when a session past its minute queries again with enforcement on", () => {
    it("refuses with 429 before the handler runs", async () => {
      const { call, handled } = served();
      for (let read = 0; read < LIMITS.readsPerMinute; read += 1) {
        await call({ procedure: "listRows", query: true });
      }

      expect(await call({ procedure: "listRows", query: true })).toBe(429);
      expect(handled).toEqual(["listRows", "listRows"]);
    });
  });
});
