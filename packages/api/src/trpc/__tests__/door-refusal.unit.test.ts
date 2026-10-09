/**
 * A staff procedure's three refusals (Q42) and the module hearing of a caller its door
 * refused (Q51), on tRPC. Spec: packages/api/specs/trpc-framework.feature.
 */
import type { Actor, PlatformTierPermission } from "@langwatch/authorization";
import { defineTrpcContract, moduleApi } from "@langwatch/module";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import {
  createTrpcRuntime,
  defineTrpcRouter,
  TrpcRootDefinition,
  type TrpcRuntimeMembers,
} from "../runtime.ts";
import { authorizeDefaults } from "../../__tests__/api-double.ts";

interface LookupApi {
  resolve(input: unknown): Promise<{ found: boolean }>;
  repair(input: unknown): Promise<{ found: boolean }>;
}

const LookupApi = moduleApi<LookupApi>()("identity");

const lookupContract = defineTrpcContract("identityLookup")
  .query("resolve")
  .withInput(z.object({ address: z.string().trim() }))
  .withOutput(z.object({ found: z.boolean() }))
  .mutation("repair")
  .withInput(z.object({ userId: z.string() }))
  .withOutput(z.object({ found: z.boolean() }))
  .build();

type LookupContext = { actor: Actor | null };

const root = TrpcRootDefinition.forContext<LookupContext>().create({});

type Grants = Readonly<Record<string, readonly PlatformTierPermission[]>>;

const GRANTS: Grants = {
  "operator-1": ["ops:view", "ops:manage"],
  "staff-1": ["ops:view"],
};

function members(grants: Grants): TrpcRuntimeMembers<LookupContext> {
  return {
    identity: { caller: (ctx) => ({ actor: ctx.actor as never }) },
    authorization: {
      forRequest: () => ({
        ...authorizeDefaults,
        getDecision: async () => ({ permitted: false, organizationRole: null }),
        getProjectAnyDecision: async () => ({ permitted: false, organizationRole: null }),
        checkScopeLineage: async () => ({ kind: "consistent" }),
        getPlatformDecision: async ({ userId, permission }) => ({
          permitted: (grants[userId] ?? []).includes(permission),
        }),
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

type Heard = { input: unknown; actor: unknown; app: unknown };

function lookup({
  actor,
  heard = [],
  ran = [],
  fails = false,
}: {
  actor: Actor | null;
  heard?: Heard[];
  ran?: string[];
  fails?: boolean;
}) {
  const app = { resolve: async () => ({ found: true }), repair: async () => ({ found: true }) };
  const handle = (name: string) =>
    (async () => {
      ran.push(name);

      return { found: true };
    }) as never;

  const router = defineTrpcRouter(LookupApi, lookupContract)
    .procedure("resolve")
    .onRefused(async (args) => {
      heard.push(args);
      if (fails) throw new Error("the trail could not be written");
    })
    .withPermission("ops:manage", { at: "platform", refusal: "hidden" })
    .handle(handle("resolve"))
    .procedure("repair")
    .withPermission("ops:manage", { at: "platform", hiddenWithout: "ops:view" })
    .handle(handle("repair"))
    .build();

  const runtime = createTrpcRuntime({ root, procedure: root.procedure, members: members(GRANTS) });

  return { app, call: runtime.mount(router, () => app).createCaller({ actor }) };
}

function refusalOf(failure: unknown): { trpc: string; code: string; meta?: unknown } {
  const error = failure as { code: string; cause?: { code: string; meta?: unknown } };

  return { trpc: error.code, code: error.cause?.code ?? "", meta: error.cause?.meta };
}

const OPERATOR: Actor = { type: "user", id: "operator-1" };
const STAFF: Actor = { type: "user", id: "staff-1" };
const STRANGER: Actor = { type: "user", id: "stranger-1" };

describe("a procedure that hides from non-staff", () => {
  describe("when the caller is anonymous, not staff, or staff lacking the write", () => {
    /** @scenario "A staff procedure hides from non-staff and refuses staff by name" */
    it("refuses UNAUTHORIZED, NOT_FOUND not_found and FORBIDDEN naming the write", async () => {
      const ran: string[] = [];
      const [anonymous, stranger, staff] = await Promise.all(
        [null, STRANGER, STAFF].map((actor) =>
          lookup({ actor, ran })
            .call.repair({ userId: "u-1" })
            .catch((error: unknown) => error),
        ),
      );

      expect((anonymous as { code: string }).code).toBe("UNAUTHORIZED");
      expect(refusalOf(stranger)).toMatchObject({ trpc: "NOT_FOUND", code: "not_found" });
      expect(refusalOf(staff)).toEqual({
        trpc: "FORBIDDEN",
        code: "permission_denied",
        meta: { permission: "ops:manage" },
      });
      expect(ran).toEqual([]);
    });
  });

  describe("when the caller holds both", () => {
    /** @scenario "A staff procedure hides from non-staff and refuses staff by name" */
    it("runs the handler", async () => {
      const ran: string[] = [];

      await expect(
        lookup({ actor: OPERATOR, ran }).call.repair({ userId: "u-1" }),
      ).resolves.toEqual({ found: true });
      expect(ran).toEqual(["repair"]);
    });
  });
});

describe("a procedure that hears of the callers its door refused", () => {
  describe("when the door refuses a caller", () => {
    /** @scenario "A procedure tells its module about a caller its door refused" */
    it("hands the module the parsed input and the caller, then answers the refusal unchanged", async () => {
      const heard: Heard[] = [];
      const ran: string[] = [];
      const { app, call } = lookup({ actor: STRANGER, heard, ran });

      const refused = await call.resolve({ address: "  sam@acme.test " }).catch((e: unknown) => e);
      const anonymous = await lookup({ actor: null, heard, ran })
        .call.resolve({ address: "sam@acme.test" })
        .catch((e: unknown) => e);

      expect(refusalOf(refused)).toMatchObject({ trpc: "NOT_FOUND", code: "not_found" });
      expect(refusalOf(anonymous)).toMatchObject({ trpc: "NOT_FOUND", code: "not_found" });
      expect(heard).toEqual([
        { app, input: { address: "sam@acme.test" }, actor: STRANGER },
        { app: expect.anything(), input: { address: "sam@acme.test" }, actor: null },
      ]);
      expect(ran).toEqual([]);
    });
  });

  describe("when the hook fails", () => {
    /** @scenario "A procedure tells its module about a caller its door refused" */
    it("fails the call rather than answer the refusal unrecorded", async () => {
      const failure = await lookup({ actor: STRANGER, fails: true })
        .call.resolve({ address: "sam@acme.test" })
        .catch((e: unknown) => e);

      expect((failure as { code: string }).code).toBe("INTERNAL_SERVER_ERROR");
    });
  });

  describe("when the door admits the caller", () => {
    /** @scenario "A procedure tells its module about a caller its door refused" */
    it("never reaches the hook", async () => {
      const heard: Heard[] = [];
      const ran: string[] = [];

      await lookup({ actor: OPERATOR, heard, ran }).call.resolve({ address: "sam@acme.test" });

      expect(heard).toEqual([]);
      expect(ran).toEqual(["resolve"]);
    });
  });

  /** @scenario "A procedure tells its module about a caller its door refused" */
  it("refuses a hook on a procedure whose door refuses nobody, and a second hook", () => {
    const select = () =>
      defineTrpcRouter(LookupApi, lookupContract)
        .procedure("resolve")
        .onRefused(() => {});

    expect(() => select().noPermission({ reason: "fixture" })).toThrow(/refuses nobody/);
    expect(() =>
      select().serviceAuthorized({ reason: "fixture", permissions: ["ops:view"] }),
    ).toThrow(/refuses nobody/);
    expect(() => select().onRefused(() => {})).toThrow(/declares onRefused twice/);
  });
});
