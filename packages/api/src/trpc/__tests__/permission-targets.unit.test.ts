/**
 * A tRPC procedure asking a permission at a further project its input names: the door asks every
 * target before the handler, and mints a proof per proof-bearing target. Spec:
 * packages/api/specs/permission-targets.feature; ADR-183 §2.
 */
import {
  type Authorization,
  type AuthzDeclaredScopeId,
  type AuthzPermission,
  sealAuthorization,
} from "@langwatch/authorization";
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

interface BraidsApi {
  preview(input: { projectId: string }): Promise<{ ok: boolean }>;
}

const BraidsApi = moduleApi<BraidsApi>()("authz");

const braidsContract = defineTrpcContract("braids")
  .query("preview")
  .withInput(z.object({ projectId: z.string(), readerProjectId: z.string() }))
  .withOutput(z.object({ ok: z.boolean() }))
  .query("own")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(z.object({ ok: z.boolean() }))
  .build();

type BraidsContext = { actor: AccessActor | null; scope?: AuthzDeclaredScopeId };

const root = TrpcRootDefinition.forContext<BraidsContext>().create({});
const READER = { via: "projectId", field: "readerProjectId" } as const;
const SAM = { type: "user", id: "user_sam" } as const;

function proofFor({ projectId, permission }: { projectId: string; permission: AuthzPermission }) {
  return sealAuthorization({
    actor: SAM,
    principal: SAM,
    scope: { organizationId: "org_acme" },
    grants: [{ projectId, permissions: [permission], via: [], kind: "own" }],
    expiresAt: Number.MAX_SAFE_INTEGER,
    purpose: { kind: "route", route: "braids.preview" },
  });
}

/** A door answering from `held`, as `permission@projectId`, and recording every question. */
function membersOf({ held, asked }: { held: ReadonlySet<string>; asked: string[] }) {
  const members: TrpcRuntimeMembers<BraidsContext> = {
    identity: {
      caller: (ctx) => ({ actor: ctx.actor, ...(ctx.scope ? { scope: ctx.scope } : {}) }),
    },
    authorization: {
      forRequest: () => ({
        ...authorizeDefaults,
        getDecision: async ({ permission, scope }) => {
          asked.push(`${permission}@${scope.id}`);

          return { permitted: held.has(`${permission}@${scope.id}`), organizationRole: "MEMBER" };
        },
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: "MEMBER" }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        projectKindOf: async () => "application",
        authorization: async ({ permission, projectId }) => proofFor({ projectId, permission }),
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

  return members;
}

function mounted({
  first,
  second,
  held,
  scope,
}: {
  first: "project:view" | "traces:view";
  second: "traces:view";
  held: ReadonlySet<string>;
  scope?: AuthzDeclaredScopeId;
}) {
  const asked: string[] = [];
  const ran: string[] = [];
  const handed: unknown[] = [];
  const app: BraidsApi = {
    preview: async ({ projectId }) => {
      ran.push(projectId);

      return { ok: true };
    },
  };
  const router = defineTrpcRouter(BraidsApi, braidsContract)
    .procedure("preview")
    .withPermission(first, { via: "projectId" })
    .withPermission(second, READER)
    .handle((args) => {
      handed.push(args);

      return args.app.preview({ projectId: args.input.projectId });
    })
    .procedure("own")
    .withPermission("traces:view", { via: "projectId" })
    .handle((args) => {
      handed.push(args);

      return args.app.preview(args.input);
    })
    .build();
  const call = createTrpcRuntime({
    root,
    procedure: root.procedure,
    members: membersOf({ held, asked }),
  })
    .mount(router, () => app)
    .createCaller({ actor: SAM, ...(scope ? { scope } : {}) });

  return {
    asked,
    ran,
    handed,
    preview: () => call.preview({ projectId: "proj_owner", readerProjectId: "proj_reader" }),
    own: () => call.own({ projectId: "proj_owner" }),
  };
}

describe("a tRPC procedure asking a permission at two projects", () => {
  describe("when the caller holds both", () => {
    /** @scenario "A procedure asking two targets asks both before its handler" */
    it("asks the owner, then the reader, and runs the handler", async () => {
      const procedure = mounted({
        first: "project:view",
        second: "traces:view",
        held: new Set(["project:view@proj_owner", "traces:view@proj_reader"]),
      });

      await expect(procedure.preview()).resolves.toEqual({ ok: true });
      expect(procedure.asked).toEqual(["project:view@proj_owner", "traces:view@proj_reader"]);
      expect(procedure.ran).toEqual(["proj_owner"]);
    });
  });

  describe("when the reader refuses the caller", () => {
    /** @scenario "A procedure refuses a caller the second target refuses, before its handler" */
    it("refuses FORBIDDEN permission_denied naming the reader and never runs the handler", async () => {
      const procedure = mounted({
        first: "project:view",
        second: "traces:view",
        held: new Set(["project:view@proj_owner"]),
      });

      const failure: unknown = await procedure.preview().catch((error) => error);

      expect(failure).toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "permission_denied", meta: { permission: "traces:view" } },
      });
      expect(procedure.asked).toEqual(["project:view@proj_owner", "traces:view@proj_reader"]);
      expect(procedure.ran).toEqual([]);
    });
  });

  describe("when both targets ask a proof-bearing permission", () => {
    /** @scenario "A procedure's handler is handed one proof per proof-bearing target" */
    it("hands a proof for each project by its field, and none by field to one target", async () => {
      const procedure = mounted({
        first: "traces:view",
        second: "traces:view",
        held: new Set(["traces:view@proj_owner", "traces:view@proj_reader"]),
      });

      await procedure.preview();
      await procedure.own();

      const [composed, single] = procedure.handed as {
        authorization: Authorization | null;
        authorizations?: Readonly<Record<string, Authorization>>;
      }[];
      expect(composed?.authorizations?.projectId?.grants[0]?.projectId).toBe("proj_owner");
      expect(composed?.authorizations?.readerProjectId?.grants[0]?.projectId).toBe("proj_reader");
      expect(composed?.authorization).toBe(composed?.authorizations?.projectId);
      expect(single?.authorization?.grants[0]?.projectId).toBe("proj_owner");
      expect(single).not.toHaveProperty("authorizations");
    });

    /** @scenario "A procedure's handler is handed one proof per proof-bearing target" */
    it("types each proof by its field, beside the first target's own proof", () => {
      const declare = () =>
        defineTrpcRouter(BraidsApi, braidsContract)
          .procedure("preview")
          .withPermission("traces:view", { via: "projectId" })
          .withPermission("traces:view", READER)
          .handle(({ app, authorization, authorizations }) => {
            const proofs: readonly Authorization[] = [
              authorization,
              authorizations.projectId,
              authorizations.readerProjectId,
            ];

            return app.preview({ projectId: String(proofs.length) });
          });
      const refusedByType = () => [
        defineTrpcRouter(BraidsApi, braidsContract)
          .procedure("own")
          .withPermission("traces:view", { via: "projectId" })
          // @ts-expect-error a procedure asking one target is handed no proofs by field
          .handle(({ app, authorizations }) => app.preview({ projectId: String(authorizations) })),
        defineTrpcRouter(BraidsApi, braidsContract)
          .procedure("preview")
          .withPermission("traces:view", { via: "projectId" })
          // @ts-expect-error a scope field names the first target, never a further one
          .withPermission("traces:view", { via: "projectId", field: "projectId" }),
      ];

      expect(declare).not.toThrow();
      expect(refusedByType).toBeTypeOf("function");
    });
  });

  describe("when the caller's credential resolved the owner project", () => {
    /** @scenario "A caller bound to one project is refused at a further target naming another" */
    it("refuses FORBIDDEN scope_input_mismatch and never runs the handler", async () => {
      const procedure = mounted({
        first: "project:view",
        second: "traces:view",
        held: new Set(["project:view@proj_owner", "traces:view@proj_reader"]),
        scope: { tier: "project", id: "proj_owner" },
      });

      const failure: unknown = await procedure.preview().catch((error) => error);

      expect(failure).toMatchObject({
        code: "FORBIDDEN",
        cause: { code: "scope_input_mismatch" },
      });
      expect(procedure.ran).toEqual([]);
    });
  });
});

describe("a further permission a procedure declares", () => {
  const selected = () => defineTrpcRouter(BraidsApi, braidsContract).procedure("preview");
  /** Asks past the types, as a caller the compiler cannot see would. */
  const further = (implementation: object, permission: string, target?: object) =>
    (Reflect.get(implementation, "withPermission") as (...args: unknown[]) => unknown)(
      permission,
      target,
    );

  /** @scenario "A procedure's further permission the composition cannot honour is refused at declaration" */
  it("is refused after a set or a platform permission, or at a target it cannot ask", () => {
    const owner = () => selected().withPermission("project:view", { via: "projectId" });

    expect(() =>
      further(
        selected().withPermission(["project:view", "project:update"], { via: "projectId" }),
        "traces:view",
        READER,
      ),
    ).toThrow(/declares withPermission\(\) twice/);
    expect(() =>
      further(selected().withPermission("ops:view", { at: "platform" }), "traces:view", READER),
    ).toThrow(/declares withPermission\(\) twice/);
    expect(() => further(owner(), "traces:view")).toThrow(/declares withPermission\(\) twice/);
    expect(() => further(owner(), "traces:view", { via: "projectId", field: "projectId" })).toThrow(
      /asks a permission at "projectId" twice/,
    );
    expect(() =>
      owner().withPermission("traces:view", READER).withPermission("project:view", READER),
    ).toThrow(/asks a permission at "readerProjectId" twice/);
    expect(() => further(owner(), "traces:view", { via: "projectId", field: "elsewhere" })).toThrow(
      /a field its input does not carry/,
    );
  });
});
