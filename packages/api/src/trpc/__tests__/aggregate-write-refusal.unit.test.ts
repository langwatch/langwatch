/**
 * The tRPC door refuses a mutation that writes under an aggregate project as read only, before
 * its handler runs (ADR-177 decision 8); reads and member-project writes pass.
 */
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { authorizeDefaults } from "../../__tests__/api-double.ts";
import type { AccessActor } from "../../access/access.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

interface RowsApi {
  create(input: { projectId: string }): Promise<{ created: boolean }>;
  list(input: { projectId: string }): Promise<{ created: boolean }>;
}

const RowsApi = moduleApi<RowsApi>()("dataset");

const rowsContract = defineTrpcContract("aggregateRows")
  .mutation("create")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ created: z.boolean() }))
  .query("list")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ created: z.boolean() }))
  .build();

type RowsContext = { actor: AccessActor | null };

const root = TrpcRootDefinition.forContext<RowsContext>().create({});

/** An organisation admin, so the aggregate admin gate admits and the write guard decides. */
function membersFor({ kind }: { kind: string }): TrpcRuntimeMembers<RowsContext> {
  return {
    identity: { caller: (ctx) => ({ actor: ctx.actor }) },
    authorization: {
      forRequest: () => ({
        ...authorizeDefaults,
        getDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "ADMIN" }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        projectKindOf: async () => kind,
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };
}

function callerFor({ kind, ran }: { kind: string; ran: string[] }) {
  const app: RowsApi = {
    create: async () => {
      ran.push("create");

      return { created: true };
    },
    list: async () => {
      ran.push("list");

      return { created: false };
    },
  };
  const router = defineTrpcRouter(RowsApi, rowsContract)
    .procedure("create")
    .withPermission("datasets:create", { via: "projectId" })
    .handle(({ app, input }) => app.create(input))
    .procedure("list")
    .withPermission("datasets:create", { via: "projectId" })
    .handle(({ app, input }) => app.list(input))
    .build();

  return createTrpcRuntime({ root, procedure: root.procedure, members: membersFor({ kind }) })
    .mount(router, () => app)
    .createCaller({ actor: { type: "user", id: "admin-1" } });
}

describe("a mutation under a write permission", () => {
  describe("when the project is an aggregate", () => {
    /** @scenario "Every write under the aggregate's tenant is refused on the server" */
    it("refuses FORBIDDEN aggregate_project_is_read_only before the handler runs", async () => {
      const ran: string[] = [];

      const failure: unknown = await callerFor({ kind: "aggregate", ran })
        .create({ projectId: "proj_aggregate" })
        .catch((error) => error);

      expect(failure).toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "aggregate_project_is_read_only" },
      });
      expect(ran).toEqual([]);
    });
  });

  describe("when the project is an ordinary member project", () => {
    it("runs the handler", async () => {
      const ran: string[] = [];

      await callerFor({ kind: "application", ran }).create({ projectId: "proj_member" });

      expect(ran).toEqual(["create"]);
    });
  });
});

describe("a query under the same permission on an aggregate", () => {
  it("runs the handler, since only mutations are write-guarded", async () => {
    const ran: string[] = [];

    await callerFor({ kind: "aggregate", ran }).list({ projectId: "proj_aggregate" });

    expect(ran).toEqual(["list"]);
  });
});
