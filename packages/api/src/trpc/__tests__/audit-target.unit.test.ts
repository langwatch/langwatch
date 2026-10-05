/**
 * A mutation whose input names a project, declared as audited against the organization, has
 * its row recorded against the organization holding that project (Alex, 2026-10-05, E10).
 * Spec: packages/api/specs/trpc-framework.feature.
 */

import type { PermissionDecision } from "@langwatch/authorization";
import { HandledError } from "@langwatch/handled-error";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { createApiDouble } from "../../__tests__/api-double.ts";
import { publicRoute, type Authorize } from "../../access/access.ts";
import type { TrpcAuditSink } from "../../hosting/api-door.ts";
import { SessionReader } from "../../hosting/session-reader.ts";
import { composeTrpcRouters } from "../compose.ts";
import { TrpcHost } from "../host.ts";
import { defineTrpcRouter } from "../runtime.ts";

interface SwitchApi {
  enable(input: { projectId: string }): Promise<{ enabled: boolean }>;
}

const SwitchApi = moduleApi<SwitchApi>()("trace");

const contract = defineTrpcContract("instantEval")
  .mutation("enable")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ enabled: z.boolean() }))

  .query("access")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ enabled: z.boolean() }))
  .build();

class SwitchRefusedError extends HandledError {
  constructor() {
    super("switch_refused", "The switch would not turn", { httpStatus: 409 });
    this.name = "SwitchRefusedError";
  }
}

function declaration() {
  return defineTrpcRouter(SwitchApi, contract)
    .procedure("enable")
    .withAudit({ target: "organization", via: "projectId" })
    .withPermission("organization:manage", { via: "projectId" })
    .handle(({ app, input }) => app.enable(input))

    .procedure("access")
    .withPermission("traces:view")
    .handle(async () => ({ enabled: true }))
    .build();
}

type Recorded = Parameters<TrpcAuditSink["record"]>[0];

function served({ resolves = true }: { resolves?: boolean } = {}) {
  const rows: Recorded[] = [];
  const organizationOf = vi.fn(async ({ id }: { tier: string; id: string }) =>
    id === "project-1" ? "organization-1" : null,
  );
  const audit: TrpcAuditSink = {
    record: (entry) => {
      rows.push(entry);
    },
    ...(resolves ? { organizationOf } : {}),
  };
  const authz = createApiDouble<Authorize>({
    getDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: "ADMIN",
    }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  });
  const trpc = TrpcHost.create({
    sessions: SessionReader.create({ verify: async () => ({ userId: "sam" }) }),
    authz,
    audit,
  });
  const enable = vi.fn(async (_input: { projectId: string }) => ({ enabled: true }));
  const mount = () =>
    trpc.mount(composeTrpcRouters("instantEval", [declaration()]), () => ({ enable }));

  /** Posts one `instantEval.enable` call through the host, as a browser would. */
  const enableFor = async (projectId: string) => {
    mount();
    const request = new Request(`http://api.test${TrpcHost.path}/instantEval.enable`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId }),
    });
    const response = await fetchRequestHandler({
      endpoint: TrpcHost.path,
      req: request,
      router: trpc.router,
      createContext: () => trpc.context({ request }),
    });

    return (await response.json()) as {
      result?: unknown;
      error?: { data?: { httpStatus?: number } };
    };
  };

  return { rows, organizationOf, enable, mount, enableFor };
}

describe("a mutation declared as audited against the organization via its projectId", () => {
  describe("when an authenticated caller's call is answered", () => {
    /** @scenario "A mutation declared as audited against its organization records the organization" */
    it("records one row naming the project's organization as its scope and its target", async () => {
      const { rows, enableFor, organizationOf } = served();

      const answer = await enableFor("project-1");

      expect(answer.result).toBeDefined();
      expect(organizationOf).toHaveBeenCalledWith({ tier: "project", id: "project-1" });
      expect(rows).toEqual([
        expect.objectContaining({
          userId: "sam",
          action: "instantEval.enable",
          organizationId: "organization-1",
          projectId: "project-1",
          targetKind: "organization",
          targetId: "organization-1",
        }),
      ]);
    });
  });

  describe("when the handler refuses the call", () => {
    /** @scenario "A mutation declared as audited against its organization records the organization" */
    it("records the refusal against the same organization", async () => {
      const { rows, enableFor, enable } = served();
      enable.mockRejectedValueOnce(new SwitchRefusedError());

      const answer = await enableFor("project-1");

      expect(answer.error?.data?.httpStatus).toBe(409);

      // The policy's own failed-call row stays beside it (a separate defect, see the handoff).
      const declared = rows.filter((row) => row.targetKind === "organization");
      expect(declared).toHaveLength(1);
      expect(declared[0]).toMatchObject({
        organizationId: "organization-1",
        projectId: "project-1",
        targetId: "organization-1",
      });
      expect(declared[0]?.error).toBeInstanceOf(Error);
    });
  });

  describe("when no organization holds the project", () => {
    /** @scenario "A mutation declared as audited against its organization records the organization" */
    it("records the row against the project alone", async () => {
      const { rows, enableFor } = served();

      await enableFor("project-orphan");

      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ projectId: "project-orphan" });
      expect(rows[0]?.organizationId).toBeUndefined();
      expect(rows[0]?.targetKind).toBeUndefined();
    });
  });

  describe("when the process's audit sink cannot say which organization holds a project", () => {
    /** @scenario "A mutation declared as audited against its organization records the organization" */
    it("refuses the mount, naming the procedure", () => {
      const { mount } = served({ resolves: false });

      expect(mount).toThrow(/instantEval\.enable records its audit row against the organization/);
    });
  });
});

describe("a declared audit target the declaration cannot honour", () => {
  const builder = () => defineTrpcRouter(SwitchApi, contract);

  describe.each([
    {
      case: "names a field its input does not carry",
      declare: () =>
        builder().procedure("enable").withAudit({ target: "organization", via: "teamId" }),
      refusal: /a field its input does not carry/,
    },
    {
      case: "is made on a query",
      declare: () =>
        builder().procedure("access").withAudit({ target: "organization", via: "projectId" }),
      refusal: /is not a mutation/,
    },
    {
      case: "is made twice",
      declare: () =>
        builder()
          .procedure("enable")
          .withAudit({ target: "organization", via: "projectId" })
          .withAudit({ target: "organization", via: "projectId" }),
      refusal: /already declares the target/,
    },
    {
      case: "is made on a procedure that runs with no caller",
      declare: () =>
        builder()
          .procedure("enable")
          .withAudit({ target: "organization", via: "projectId" })
          .withAccess(publicRoute({ reason: "nobody is behind it" })),
      refusal: /writes no audit row/,
    },
  ])("when it $case", ({ declare, refusal }) => {
    /** @scenario "A mutation declared as audited against its organization records the organization" */
    it("is refused where it is written", () => {
      expect(declare).toThrow(refusal);
    });
  });
});
