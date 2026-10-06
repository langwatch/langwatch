/**
 * A permission chosen from the parsed input (E3) and a named plan capability (E6), on tRPC.
 * Spec: packages/api/specs/trpc-framework.feature.
 */
import { HandledError } from "@langwatch/handled-error";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { permissionBy } from "../../access/input-permission.ts";
import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";

/** The refusal a process gives for the webhook endpoints capability. */
class NoWebhookEndpointsError extends HandledError {
  constructor() {
    super("forbidden", "The plan holds no webhook endpoints", {
      httpStatus: 403,
      fault: "customer",
    });
  }
}

interface RetentionApi {
  setForScope(input: unknown): Promise<{ done: boolean }>;
  setPlan(input: unknown): Promise<{ done: boolean }>;
}

const RetentionApi = moduleApi<RetentionApi>()("data-retention");

const retentionContract = defineTrpcContract("retention")
  .mutation("setForScope")
  .withInput(
    z.object({
      scope: z.object({
        scopeType: z.enum(["ORGANIZATION", "TEAM", "PROJECT"]),
        scopeId: z.string(),
      }),
    }),
  )
  .withOutput(z.object({ done: z.boolean() }))
  .mutation("setPlan")
  .withInput(z.object({ projectId: z.string(), tier: z.enum(["basic", "full"]) }))
  .withOutput(z.object({ done: z.boolean() }))
  .build();

type RetentionContext = { actor: { id: string } };

const retentionRoot = TrpcRootDefinition.forContext<RetentionContext>().create({});

const BY_SCOPE_TYPE = permissionBy({
  field: "scope.scopeType",
  map: {
    ORGANIZATION: {
      permission: "organization:manage",
      tier: "organization",
      field: "scope.scopeId",
    },
    TEAM: { permission: "team:manage", tier: "team", field: "scope.scopeId" },
    PROJECT: { permission: "project:update", tier: "project", field: "scope.scopeId" },
  },
});

type Asked = { permission: string; scope: { tier: string; id: string } };

function members({
  permitted = () => true,
  holds,
}: {
  permitted?: (permission: string) => boolean;
  holds?: NonNullable<TrpcRuntimeMembers<RetentionContext>["entitlements"]>["holds"];
}) {
  const asked: Asked[] = [];
  const declared: TrpcRuntimeMembers<RetentionContext> = {
    identity: { caller: (ctx) => ({ actor: { type: "user", id: ctx.actor.id } }) },
    authorization: {
      forRequest: () => ({
        getDecision: async ({ permission, scope }) => {
          asked.push({ permission, scope });

          return { permitted: permitted(permission), organizationRole: null };
        },
        getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
      }),
    },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: () => new Error("lite member"),
    },
    ...(holds
      ? {
          entitlements: {
            holds,
            refusal: ({ entitlement }) =>
              entitlement === "webhook_endpoints"
                ? new NoWebhookEndpointsError()
                : new Error("an entitlement this process does not refuse"),
          },
        }
      : {}),
    audit: { record: async () => {}, redact: ({ args }) => args, exempt: () => false },
    errors: {
      report: () => {},
      asError: (failure) => (failure instanceof Error ? failure : new Error(String(failure))),
      translate: () => undefined,
    },
  };

  return { asked, declared };
}

function caller({
  permitted,
  holds,
  ran,
}: {
  permitted?: (permission: string) => boolean;
  holds?: NonNullable<TrpcRuntimeMembers<RetentionContext>["entitlements"]>["holds"];
  ran: string[];
}) {
  const { asked, declared } = members({
    ...(permitted ? { permitted } : {}),
    holds: holds ?? (async () => true),
  });
  const handle = (name: string) =>
    (async () => {
      ran.push(name);

      return { done: true };
    }) as never;

  const router = defineTrpcRouter(RetentionApi, retentionContract)
    .procedure("setForScope")
    .withPermission(BY_SCOPE_TYPE)
    .handle(handle("setForScope"))
    .procedure("setPlan")
    .withEntitlement("webhook_endpoints", { feature: "Webhook endpoints" })
    .withPermission(
      permissionBy({ field: "tier", map: { basic: "project:view", full: "project:update" } }),
      { via: "projectId" },
    )
    .handle(handle("setPlan"))
    .build();

  const runtime = createTrpcRuntime({
    root: retentionRoot,
    procedure: retentionRoot.procedure,
    members: declared,
  });

  return {
    asked,
    call: runtime
      .mount(router, () => ({
        setForScope: async () => ({ done: true }),
        setPlan: async () => ({ done: true }),
      }))
      .createCaller({ actor: { id: "user-1" } }),
  };
}

function causeOf(failure: unknown): { code: string; meta: Record<string, unknown> } {
  return (failure as { cause: { code: string; meta: Record<string, unknown> } }).cause;
}

describe("a procedure that chooses its permission from its parsed input", () => {
  describe("when the input names a team", () => {
    /** @scenario "A procedure chooses its permission from its parsed input" */
    it("asks the team's permission at the team its entry names, then runs the handler", async () => {
      const ran: string[] = [];
      const { asked, call } = caller({ ran });

      await expect(
        call.setForScope({ scope: { scopeType: "TEAM", scopeId: "team-1" } }),
      ).resolves.toEqual({ done: true });

      expect(asked).toEqual([{ permission: "team:manage", scope: { tier: "team", id: "team-1" } }]);
      expect(ran).toEqual(["setForScope"]);
    });
  });

  describe("when the entry is the permission alone", () => {
    /** @scenario "A procedure chooses its permission from its parsed input" */
    it("asks it at the procedure's own scope field", async () => {
      const ran: string[] = [];
      const { asked, call } = caller({ ran, holds: async () => true });

      await call.setPlan({ projectId: "project-1", tier: "full" });

      expect(asked).toEqual([
        { permission: "project:update", scope: { tier: "project", id: "project-1" } },
      ]);
    });
  });

  describe("when the caller lacks the chosen permission", () => {
    /** @scenario "A procedure chooses its permission from its parsed input" */
    it("refuses naming that permission, and never runs the handler", async () => {
      const ran: string[] = [];
      const { call } = caller({
        ran,
        permitted: (permission) => permission !== "organization:manage",
      });

      const failure = await call
        .setForScope({ scope: { scopeType: "ORGANIZATION", scopeId: "org-1" } })
        .catch((error: unknown) => error);

      expect(causeOf(failure).code).toBe("permission_denied");
      expect(causeOf(failure).meta).toMatchObject({ permission: "organization:manage" });
      expect(ran).toEqual([]);
    });
  });

  describe("when the scope id is blank", () => {
    /** @scenario "A procedure chooses its permission from its parsed input" */
    it("refuses with the caller's validation error", async () => {
      const ran: string[] = [];
      const { call } = caller({ ran });

      const failure = await call
        .setForScope({ scope: { scopeType: "PROJECT", scopeId: " " } })
        .catch((error: unknown) => error);

      expect(causeOf(failure).code).toBe("validation_error");
      expect(ran).toEqual([]);
    });
  });

  describe("when the map does not match its field", () => {
    const select = () => defineTrpcRouter(RetentionApi, retentionContract).procedure("setForScope");

    /** @scenario "A procedure chooses its permission from its parsed input" */
    it("refuses a missing value, an extra key, an open field and a tier that cannot grant", () => {
      expect(() =>
        select().withPermission(
          // @ts-expect-error the map names no permission for PROJECT
          permissionBy({
            field: "scope.scopeType",
            map: { ORGANIZATION: "organization:manage", TEAM: "team:manage" },
          }),
        ),
      ).toThrow(/unnamed: PROJECT/);

      expect(() =>
        select().withPermission(
          // @ts-expect-error the map names a value the field never parses as
          permissionBy({
            field: "scope.scopeType",
            map: {
              ORGANIZATION: "organization:manage",
              TEAM: "team:manage",
              PROJECT: "project:update",
              PLATFORM: "project:update",
            },
          }),
        ),
      ).toThrow(/not parsed: PLATFORM/);

      expect(() =>
        select().withPermission(permissionBy({ field: "scope.scopeId", map: {} }) as never),
      ).toThrow(/does not parse as a fixed set of values/);

      expect(() =>
        select().withPermission({
          ...BY_SCOPE_TYPE,
          map: {
            ...BY_SCOPE_TYPE.map,
            PROJECT: { permission: "organization:manage", tier: "project", field: "scope.scopeId" },
          },
        }),
      ).toThrow(/a tier that cannot grant it/);
    });
  });
});

describe("a procedure that asks for a named plan capability", () => {
  /** @scenario "A procedure asks whether its tenant holds a named plan capability" */
  it("asks the plan about that capability by name, at the scope access resolved", async () => {
    const ran: string[] = [];
    const holds = vi.fn(async () => true);
    const { call } = caller({ ran, holds });

    await call.setPlan({ projectId: "project-1", tier: "basic" });

    expect(holds).toHaveBeenCalledWith({
      entitlement: "webhook_endpoints",
      scope: { tier: "project", id: "project-1" },
    });
    expect(ran).toEqual(["setPlan"]);
  });

  /** @scenario "A procedure asks whether its tenant holds a named plan capability" */
  it("refuses a tenant without it with the process's refusal for that capability", async () => {
    const ran: string[] = [];
    const { call } = caller({ ran, holds: async () => false });

    const failure = await call
      .setPlan({ projectId: "project-1", tier: "basic" })
      .catch((error: unknown) => error);

    expect(causeOf(failure).code).toBe("forbidden");
    expect(ran).toEqual([]);
  });
});
