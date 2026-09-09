/** @vitest-environment node */

/**
 * The policy spine's own behaviour, over the ports interface: which decision
 * each declared builder asks for, what a declared check leaves on the request
 * context, how the lineage guard shapes its refusal, and the compile-time half
 * of the builder that makes a declaration mandatory.
 *
 * The authorization port is a bare mock here — the engine's own decisions are
 * `authz-service.facade.unit.test.ts`'s business.
 * Spec: modules/authz/specs/permission-resolution.feature
 */
import {
  type AuthzGetDecisionInput,
  type AuthzGetProjectAnyDecisionInput,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
  authzDeclarationOf,
  BlankScopeIdError,
  type DeclaredAuthzMiddleware,
  type PermissionDecision,
  PermissionDeniedError,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import {
  createDeclaredAuthzMiddlewares,
  createScopeLineageGuard,
  type PendingPermissionProcedureBuilder,
  type TrpcAuthorizationDecisions,
  type TrpcAuthorizationPort,
  type TrpcCheckMiddleware,
  type TrpcDeclaredAuthzContext,
  type TrpcDeclaredAuthzPorts,
  type TrpcMiddlewareContext,
} from "../policy.ts";

/**
 * `actorId: undefined` is the anonymous caller, so it cannot be a destructuring
 * default: the key's PRESENCE is what chooses, not its value.
 */
function makePorts(
  options: {
    actorId?: string | undefined;
    getDecision?: ReturnType<
      typeof vi.fn<(input: AuthzGetDecisionInput) => Promise<PermissionDecision>>
    >;
    getProjectAnyDecision?: ReturnType<
      typeof vi.fn<(input: AuthzGetProjectAnyDecisionInput) => Promise<PermissionDecision>>
    >;
  } = {},
): TrpcDeclaredAuthzPorts<TrpcDeclaredAuthzContext> & {
  decisions: TrpcAuthorizationDecisions;
} {
  const actorId = "actorId" in options ? options.actorId : "alice";
  const getDecision =
    options.getDecision ??
    vi
      .fn<(input: AuthzGetDecisionInput) => Promise<PermissionDecision>>()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" });
  const getProjectAnyDecision =
    options.getProjectAnyDecision ??
    vi
      .fn<(input: AuthzGetProjectAnyDecisionInput) => Promise<PermissionDecision>>()
      .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" });
  const checkScopeLineage =
    vi.fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>();
  const decisions: TrpcAuthorizationDecisions = {
    getDecision,
    getProjectAnyDecision,
    checkScopeLineage,
  };
  return {
    identity: { actor: () => (actorId ? { id: actorId } : undefined) },
    authorization: { forRequest: () => decisions },
    denials: {
      membershipDisabled: () => new Error("membership disabled"),
      liteMemberRestricted: (resource: string) => new Error(`lite member: ${resource}`),
    },
    decisions,
  };
}

function ctxFor(): TrpcMiddlewareContext<TrpcDeclaredAuthzContext> {
  return { permissionChecked: false, organizationRole: undefined };
}

const rejection = async (run: () => Promise<unknown>): Promise<TRPCError> => {
  try {
    await run();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected the middleware to throw");
};

describe("createDeclaredAuthzMiddlewares", () => {
  describe(".permission", () => {
    describe("given the request context carries its own authorization decisions", () => {
      /** @scenario "Every grant check decides through the App the request context carries" */
      it("resolves the decision through the port's forRequest, never a module-level singleton", async () => {
        const ports = makePorts();
        const checks = createDeclaredAuthzMiddlewares(ports);
        const ctx = ctxFor();
        const next = vi.fn().mockReturnValue("next-called");

        await checks.permission({ permission: "traces:view" })({
          ctx,
          input: { projectId: "proj-1" },
          next,
        });

        expect(ports.decisions.getDecision).toHaveBeenCalledWith({
          userId: "alice",
          permission: "traces:view",
          scope: { tier: "project", id: "proj-1" },
        });
        expect(ctx.permissionChecked).toBe(true);
        expect(next).toHaveBeenCalled();
      });
    });

    describe("when no session backs the request", () => {
      /** @scenario "An unauthenticated caller is refused before any scope id is read" */
      it("refuses without asking for a decision or reading the scope id", async () => {
        const getDecision = vi.fn<(input: AuthzGetDecisionInput) => Promise<PermissionDecision>>();
        const ports = makePorts({ actorId: undefined, getDecision });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const ctx = ctxFor();
        const next = vi.fn();

        const error = await rejection(() =>
          checks.permission({ permission: "traces:view" })({
            ctx,
            input: { projectId: "proj-1" },
            next,
          }),
        );

        expect(error).toBeInstanceOf(TRPCError);
        expect(error.code).toBe("UNAUTHORIZED");
        expect(getDecision).not.toHaveBeenCalled();
        expect(next).not.toHaveBeenCalled();
        expect(ctx.permissionChecked).toBe(false);
      });
    });

    describe("when the decision names the caller's organization role", () => {
      /** @scenario "A permitted decision carries the organization role onto the request" */
      it("carries it onto the context for the resolver behind the check", async () => {
        const checks = createDeclaredAuthzMiddlewares(
          makePorts({
            getDecision: vi
              .fn()
              .mockResolvedValue({ permitted: true, organizationRole: "EXTERNAL" }),
          }),
        );
        const ctx = ctxFor();

        await checks.permission({ permission: "traces:view" })({
          ctx,
          input: { projectId: "proj-1" },
          next: vi.fn(),
        });

        expect(ctx.organizationRole).toBe("EXTERNAL");
        expect(ctx.permissionChecked).toBe(true);
      });
    });

    describe("when the decision reports no organization role", () => {
      /** @scenario "A permitted decision carries the organization role onto the request" */
      it("leaves the context's role untouched, as the organization tier always did", async () => {
        const checks = createDeclaredAuthzMiddlewares(
          makePorts({
            getDecision: vi.fn().mockResolvedValue({ permitted: true, organizationRole: null }),
          }),
        );
        const ctx = ctxFor();

        await checks.permission({ permission: "organization:view" })({
          ctx,
          input: { organizationId: "org-1" },
          next: vi.fn(),
        });

        expect(ctx.organizationRole).toBeUndefined();
        expect(ctx.permissionChecked).toBe(true);
      });
    });

    describe("when the caller is denied", () => {
      /** @scenario "A denial carries a stable code the client can present" */
      it("refuses with the one handled code, naming the permission and tier", async () => {
        const ports = makePorts({
          getDecision: vi.fn().mockResolvedValue({ permitted: false, organizationRole: "MEMBER" }),
        });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const error = await rejection(() =>
          checks.permission({ permission: "traces:view" })({
            ctx: ctxFor(),
            input: { projectId: "proj-1" },
            next: vi.fn(),
          }),
        );
        expect(error.cause).toBeInstanceOf(PermissionDeniedError);
        const cause = error.cause as PermissionDeniedError;
        expect(cause.code).toBe("permission_denied");
        expect(cause.meta).toMatchObject({ permission: "traces:view", scopeType: "project" });
      });

      /** @scenario "A scope id that resolves to nothing is denied like one the caller may not touch" */
      it("answers an unknown id identically to a denied one, revealing nothing about it", async () => {
        const ports = makePorts({
          getDecision: vi.fn().mockResolvedValue({ permitted: false, organizationRole: null }),
        });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const error = await rejection(() =>
          checks.permission({ permission: "traces:view" })({
            ctx: ctxFor(),
            input: { projectId: "does-not-exist" },
            next: vi.fn(),
          }),
        );
        expect((error.cause as PermissionDeniedError).code).toBe("permission_denied");
        expect(error.message).not.toContain("does-not-exist");
      });

      /** @scenario "A lite member's denial is distinguishable from a missing grant" */
      it("carries the lite-member restriction for an EXTERNAL caller", async () => {
        const ports = makePorts({
          getDecision: vi
            .fn()
            .mockResolvedValue({ permitted: false, organizationRole: "EXTERNAL" }),
        });
        const checks = createDeclaredAuthzMiddlewares(ports);
        const error = await rejection(() =>
          checks.permission({ permission: "team:manage" })({
            ctx: ctxFor(),
            input: { teamId: "team-1" },
            next: vi.fn(),
          }),
        );
        expect((error.cause as Error).message).toContain("lite member");
      });

      /** @scenario "A denied request is never marked as checked" */
      it("never marks the request as checked, so the backstop still refuses it", async () => {
        const checks = createDeclaredAuthzMiddlewares(
          makePorts({
            getDecision: vi
              .fn()
              .mockResolvedValue({ permitted: false, organizationRole: "MEMBER" }),
          }),
        );
        const ctx = ctxFor();
        const next = vi.fn();

        await expect(
          checks.permission({ permission: "datasets:manage" })({
            ctx,
            input: { projectId: "proj-1" },
            next,
          }),
        ).rejects.toBeInstanceOf(TRPCError);

        expect(ctx.permissionChecked).toBe(false);
        expect(next).not.toHaveBeenCalled();
      });
    });
  });

  describe(".permissionAny", () => {
    /** @scenario "Any one of several declared permissions is enough" */
    it("permits on the resolver's any-of answer and names the first permission when denied", async () => {
      const ports = makePorts();
      const checks = createDeclaredAuthzMiddlewares(ports);
      const ctx = ctxFor();

      await checks.permissionAny(["traces:view", "scenarios:view"])({
        ctx,
        input: { projectId: "proj-1" },
        next: vi.fn().mockReturnValue("next-called"),
      });
      expect(ports.decisions.getProjectAnyDecision).toHaveBeenCalledWith({
        userId: "alice",
        projectId: "proj-1",
        permissions: ["traces:view", "scenarios:view"],
      });
      expect(ctx.permissionChecked).toBe(true);

      const denyingPorts = makePorts({
        getProjectAnyDecision: vi
          .fn()
          .mockResolvedValue({ permitted: false, organizationRole: "MEMBER" }),
      });
      const denyingChecks = createDeclaredAuthzMiddlewares(denyingPorts);
      const error = await rejection(() =>
        denyingChecks.permissionAny(["traces:view", "scenarios:view"])({
          ctx: ctxFor(),
          input: { projectId: "proj-1" },
          next: vi.fn(),
        }),
      );
      expect((error.cause as PermissionDeniedError).meta).toMatchObject({
        permission: "traces:view",
      });
    });

    /** @scenario "A blank project id on a multi-permission check is answered the same way" */
    it("answers a blank project id as invalid input, not an internal error", async () => {
      const ports = makePorts();
      const checks = createDeclaredAuthzMiddlewares(ports);
      const error = await rejection(() =>
        checks.permissionAny(["traces:view", "scenarios:view"])({
          ctx: ctxFor(),
          input: { projectId: "" },
          next: vi.fn(),
        }),
      );
      expect(error.code).toBe("BAD_REQUEST");
      expect(error.cause).toBeInstanceOf(BlankScopeIdError);
      expect(ports.decisions.getProjectAnyDecision).not.toHaveBeenCalled();
    });
  });

  describe(".noPermission", () => {
    /** @scenario "Opting out of permission checks requires a written reason" */
    it("runs for any authenticated caller and records its reason in the declaration", async () => {
      const checks = createDeclaredAuthzMiddlewares(makePorts());
      const middleware = checks.noPermission({ reason: "user-scoped preferences only" });
      const ctx = ctxFor();
      await middleware({ ctx, input: {}, next: vi.fn().mockReturnValue("next-called") });
      expect(ctx.permissionChecked).toBe(true);
      expect(authzDeclarationOf(middleware)).toMatchObject({
        kind: "no-permission",
        reason: "user-scoped preferences only",
      });
    });

    /** @scenario "An opted-out procedure cannot silently read scoped input" */
    it("still refuses an unallowed scope id at runtime, defense in depth", async () => {
      const checks = createDeclaredAuthzMiddlewares(makePorts());
      const middleware = checks.noPermission({ reason: "nothing scoped" });
      await expect(
        middleware({ ctx: ctxFor(), input: { projectId: "proj-1" }, next: vi.fn() }),
      ).rejects.toThrow("projectId is not allowed");

      const allowed = checks.noPermission({
        reason: "creation flow",
        allow: { organizationId: "creating inside this organization" },
      });
      await expect(
        allowed({
          ctx: ctxFor(),
          input: { organizationId: "org-1" },
          next: vi.fn().mockReturnValue("next-called"),
        }),
      ).resolves.toBe("next-called");
    });
  });

  describe(".serviceAuthorized", () => {
    /** @scenario "A service-authorized procedure declares the permissions its service enforces" */
    it("marks the check as deferred and names the enforced permissions", async () => {
      const checks = createDeclaredAuthzMiddlewares(makePorts());
      const middleware = checks.serviceAuthorized({
        reason: "the row's own scope set decides",
        permissions: ["traces:view"],
      });
      const ctx = ctxFor();
      await middleware({ ctx, next: vi.fn().mockReturnValue("next-called") });
      expect(ctx.permissionChecked).toBe(true);
      expect(authzDeclarationOf(middleware)).toMatchObject({
        kind: "service-authorized",
        permissions: ["traces:view"],
      });
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The tRPC adapter for the lineage guard: it hands the input to the
// authorization port's `checkScopeLineage` and shapes the refusal. The lineage
// DECISION itself is `@langwatch/authz-contract`'s own business.
// ─────────────────────────────────────────────────────────────────────────────

function lineagePorts(
  checkScopeLineage: ReturnType<
    typeof vi.fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>
  >,
): Readonly<{ authorization: TrpcAuthorizationPort<unknown> }> {
  return {
    authorization: {
      forRequest: () => ({
        checkScopeLineage,
        getDecision: vi.fn(),
        getProjectAnyDecision: vi.fn(),
      }),
    },
  };
}

describe("createScopeLineageGuard", () => {
  describe("when the port reports a mismatch across organizations", () => {
    /** @scenario "Scope ids from two organizations in one request are refused" */
    it("refuses before the handler runs, shaped as a permission denial", async () => {
      const checkScopeLineage = vi
        .fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>()
        .mockResolvedValue({
          kind: "mismatch",
          widest: { tier: "organization", id: "org_victim" },
          entries: [],
        });
      const guard = createScopeLineageGuard(lineagePorts(checkScopeLineage));
      const next = vi.fn();

      const error = await rejection(() =>
        guard({ kind: "permission", permission: "auditLog:view" })({
          ctx: {},
          input: { organizationId: "org_victim", projectId: "project_mine" },
          next,
        }),
      );

      expect(checkScopeLineage).toHaveBeenCalledWith({
        organizationId: "org_victim",
        projectId: "project_mine",
      });
      expect(next).not.toHaveBeenCalled();
      expect(error.cause).toBeInstanceOf(PermissionDeniedError);
      expect((error.cause as PermissionDeniedError).meta).toMatchObject({
        permission: "auditLog:view",
        scopeType: "organization",
      });
    });
  });

  describe("when a scope id resolves to no organization at all", () => {
    /** @scenario "A scope id resolving to no organization cannot anchor a mixed request" */
    it("fails closed on the port's mismatch verdict rather than treating it as agreeing", async () => {
      const checkScopeLineage = vi
        .fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>()
        .mockResolvedValue({
          kind: "mismatch",
          widest: { tier: "project", id: "project_ghost" },
          entries: [],
        });
      const guard = createScopeLineageGuard(lineagePorts(checkScopeLineage));
      const next = vi.fn();

      await expect(
        guard({ kind: "permission", permission: "auditLog:view" })({
          ctx: {},
          input: { organizationId: "org_1", projectId: "project_ghost" },
          next,
        }),
      ).rejects.toBeInstanceOf(Error);
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when every scope id resolves to one organization", () => {
    /** @scenario "A request whose scope ids agree passes the lineage guard untouched" */
    it("passes through to the declared check", async () => {
      const checkScopeLineage = vi
        .fn<(input: AuthzScopeLineageInput) => Promise<AuthzScopeLineageResult>>()
        .mockResolvedValue({ kind: "consistent" });
      const guard = createScopeLineageGuard(lineagePorts(checkScopeLineage));
      const next = vi.fn().mockReturnValue("handled");

      await expect(
        guard({ kind: "permission", permission: "auditLog:view" })({
          ctx: {},
          input: { organizationId: "org_1", teamId: "team_1", projectId: "project_1" },
          next,
        }),
      ).resolves.toBe("handled");
      expect(next).toHaveBeenCalledTimes(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The compile-time half of the declaring builder: after `.input()` a pending
// builder offers only the declaring methods, and its `.use()` escape hatch
// accepts only a branded declared check.
// ─────────────────────────────────────────────────────────────────────────────

type Equal<Left, Right> =
  (<Value>() => Value extends Left ? 1 : 2) extends <Value>() => Value extends Right ? 1 : 2
    ? true
    : false;
type Assert<Value extends true> = Value;

type Pending = PendingPermissionProcedureBuilder<
  { actor: { id: string } },
  { actor: { id: string } },
  object,
  object,
  { projectId: string },
  { projectId: string },
  unknown,
  unknown,
  false
>;

describe("PendingPermissionProcedureBuilder", () => {
  describe("given a procedure that has declared its input", () => {
    /** @scenario "A service endpoint that declares no access fails to compile" */
    /** @scenario "Every tRPC procedure declares its access decision or an explicit reason not to" */
    it("offers only the declaring methods — no .query, .mutation or .subscription", () => {
      type _DeclarationIsMandatoryByConstruction = Assert<
        Equal<
          keyof Pending,
          "input" | "use" | "permission" | "permissionAny" | "noPermission" | "authorizeInService"
        >
      >;
      expect(true satisfies _DeclarationIsMandatoryByConstruction).toBe(true);
    });
  });

  describe("given the custom-check escape hatch", () => {
    /** @scenario "A hand-rolled procedure middleware cannot claim a permission check" */
    it("accepts only middleware carrying the declaration brand, not a bare function", () => {
      type UseParam = Parameters<Pending["use"]>[0];
      type BareMiddleware = TrpcCheckMiddleware<{ actor: { id: string } }, { projectId: string }>;

      type _BrandRequired = Assert<Equal<UseParam, DeclaredAuthzMiddleware<BareMiddleware>>>;
      type _BareMiddlewareRefused = Assert<BareMiddleware extends UseParam ? false : true>;
      expect(true satisfies _BrandRequired).toBe(true);
      expect(true satisfies _BareMiddlewareRefused).toBe(true);
    });
  });
});
