/** @vitest-environment node */

/**
 * The declared seam's own behaviour: which input id becomes the check scope
 * (the registry decides, not blind precedence), what an unauthenticated or
 * miswired call gets, and the SHAPE of a refusal. The fork-aware resolvers
 * are `rbac.ts`'s business and are stubbed here — decision-neutrality against
 * them is their own suite's job.
 *
 * The refusal shape is the sharp part. An unknown id and a denied id have to
 * come out identical: when the unknown branch answered with a bare
 * "UNAUTHORIZED" and no error code, it told an outsider whether an id EXISTS,
 * and left the client rendering "unknown error" for a denial it could have
 * named.
 */
import {
  BlankScopeIdError,
  PermissionDeniedError,
} from "@langwatch/authz-contract";
import type { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  LiteMemberRestrictedError,
  MembershipDisabledError,
} from "~/server/app-layer/permissions/errors";

/**
 * Severity is behaviour here, not decoration: the blank-id split exists so a
 * caller's empty string stops being logged as a platform fault, and only an
 * assertion on the error channel can hold that.
 */
const loggedError = vi.fn();
vi.mock("@langwatch/observability", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    createLogger: () => ({
      error: (...args: unknown[]) => loggedError(...args),
      warn: vi.fn(),
      info: vi.fn(),
      debug: vi.fn(),
      trace: vi.fn(),
    }),
  };
});

const resolveProjectPermission = vi.fn();
const resolveTeamPermission = vi.fn();
const hasOrganizationPermission = vi.fn();
const resolveProjectPermissionAny = vi.fn();

vi.mock("~/server/api/rbac", () => ({
  resolveProjectPermission: (...args: unknown[]) => resolveProjectPermission(...args),
  resolveTeamPermission: (...args: unknown[]) => resolveTeamPermission(...args),
  hasOrganizationPermission: (...args: unknown[]) => hasOrganizationPermission(...args),
  resolveProjectPermissionAny: (...args: unknown[]) => resolveProjectPermissionAny(...args),
}));

// The context owns the exact App the middleware uses. This mocked App keeps
// the real compatibility service over the resolver stubs above.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

const {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} = await import("../trpc-middleware");
const { authzDeclarationOf } = await import("@langwatch/authz-contract");
const { getApp } = await import("~/server/app-layer/app");

const session = { user: { id: "alice" } };
const app = getApp();

const paramsFor = (
  input: Record<string, string | undefined>,
  { authed = true }: { authed?: boolean } = {},
) => ({
  ctx: {
    session: (authed ? session : null) as any,
    app,
    permissionChecked: false,
    organizationRole: undefined as any,
  },
  input,
  next: vi.fn().mockReturnValue("next-called"),
});

/** The caught error, always — `rejects` alone would not let us read `cause`. */
const rejection = async (run: () => Promise<unknown>): Promise<TRPCError> => {
  try {
    await run();
  } catch (error) {
    return error as TRPCError;
  }
  throw new Error("expected the middleware to throw");
};

beforeEach(() => {
  vi.clearAllMocks();
  resolveProjectPermission.mockResolvedValue({
    permitted: true,
    organizationRole: "MEMBER",
  });
  resolveTeamPermission.mockResolvedValue({
    permitted: true,
    organizationRole: "MEMBER",
  });
  hasOrganizationPermission.mockResolvedValue(true);
  resolveProjectPermissionAny.mockResolvedValue({
    permitted: true,
    organizationRole: "MEMBER",
  });
});

describe("checkDeclaredPermission", () => {
  describe("given input carrying every scope id", () => {
    /** @scenario "The most specific tier the permission allows decides the check scope" */
    it("checks the most specific tier the permission is grantable at", async () => {
      const params = paramsFor({
        projectId: "proj-1",
        teamId: "team-1",
        organizationId: "org-1",
      });
      await checkDeclaredPermission({ permission: "traces:view" })(params as any);
      expect(resolveProjectPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          session: { user: { id: "alice" }, expires: "" },
        }),
        "proj-1",
        "traces:view",
      );
      expect(resolveTeamPermission).not.toHaveBeenCalled();
      expect(hasOrganizationPermission).not.toHaveBeenCalled();
      expect(params.ctx.permissionChecked).toBe(true);
      expect(params.ctx.organizationRole).toBe("MEMBER");
    });

    it("skips tiers an organization-only permission cannot be granted at", async () => {
      const params = paramsFor({
        projectId: "proj-1",
        organizationId: "org-1",
      });
      await checkDeclaredPermission({ permission: "organization:manage" })(params as any);
      expect(hasOrganizationPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          session: { user: { id: "alice" }, expires: "" },
        }),
        "org-1",
        "organization:manage",
      );
      expect(resolveProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe("given a via derivation", () => {
    /** @scenario "A scope derivation is written at the call site, never inferred" */
    it("checks at the named field's own tier", async () => {
      const params = paramsFor({ teamId: "team-1" });
      await checkDeclaredPermission({
        permission: "organization:manage",
        via: "teamId",
      })(params as any);
      expect(resolveTeamPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          session: { user: { id: "alice" }, expires: "" },
        }),
        "team-1",
        "organization:manage",
      );
      expect(hasOrganizationPermission).not.toHaveBeenCalled();
    });
  });

  describe("given the request context carries an App", () => {
    /** @scenario "Application tRPC remains a separate adapter" */
    /** @scenario "Every grant check decides through the App the request context carries" */
    it("decides through the injected App, never composing its own", async () => {
      const getDecision = vi
        .fn()
        .mockResolvedValue({ permitted: true, organizationRole: "MEMBER" });
      const params = paramsFor({ projectId: "proj-1" });
      (params.ctx as { app?: unknown }).app = {
        permissions: { getDecision },
      };

      await checkDeclaredPermission({ permission: "traces:view" })(params as any);

      expect(getDecision).toHaveBeenCalledWith({
        userId: "alice",
        permission: "traces:view",
        scope: { tier: "project", id: "proj-1" },
      });
      // The module-level App was never consulted — the context's instance is
      // the one that decides.
      expect(resolveProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is unauthenticated", () => {
    it("answers UNAUTHORIZED before reading any id", async () => {
      const params = paramsFor({ projectId: "proj-1" }, { authed: false });
      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(params as any),
      );
      expect(error.code).toBe("UNAUTHORIZED");
      expect(resolveProjectPermission).not.toHaveBeenCalled();
    });
  });

  describe("when the input names no scope id at all", () => {
    /** @scenario "An input carrying no scope id at all is still a wiring bug" */
    it("fails loudly as a wiring bug, not a denial", async () => {
      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(paramsFor({}) as any),
      );
      expect(error.code).toBe("INTERNAL_SERVER_ERROR");
      expect(loggedError).toHaveBeenCalledWith(
        expect.objectContaining({ permission: "traces:view" }),
        "declared permission's input carries no usable scope id",
      );
    });
  });

  describe("when the caller leaves the scope id blank", () => {
    /** @scenario "A scope id the caller left blank is answered as invalid input" */
    it("answers invalid input, naming the field, without deciding anything", async () => {
      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(paramsFor({ projectId: "" }) as any),
      );

      expect(error.code).toBe("BAD_REQUEST");
      const cause = error.cause as BlankScopeIdError;
      expect(cause).toBeInstanceOf(BlankScopeIdError);
      expect(cause.code).toBe("validation_error");
      expect(cause.fault).toBe("customer");
      expect(cause.httpStatus).toBe(400);
      expect(cause.meta.fieldErrors).toEqual({ projectId: ["Required"] });
      // The caller's own blank string never becomes a probe for someone
      // else's scope, so no decision is asked for.
      expect(resolveProjectPermission).not.toHaveBeenCalled();
    });

    /**
     * The regression this whole split exists for: a routine bad request used
     * to land on the error dashboard as a platform fault and page the team.
     *
     * @scenario "A scope id the caller left blank is answered as invalid input"
     */
    it("does not report the caller's blank id as an internal error", async () => {
      await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(paramsFor({ projectId: "" }) as any),
      );
      expect(loggedError).not.toHaveBeenCalled();
    });

    /** @scenario "A blank scope id never shadows one the caller did fill in" */
    it("still checks at a wider tier the caller did fill in", async () => {
      const params = paramsFor({
        projectId: "",
        organizationId: "org-1",
      });

      await expect(
        checkDeclaredPermission({ permission: "traces:view" })(params as any),
      ).resolves.toBe("next-called");

      expect(hasOrganizationPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          session: { user: { id: "alice" }, expires: "" },
        }),
        "org-1",
        "traces:view",
      );
    });
  });

  describe("when the resolver denies", () => {
    /** @scenario "A denial carries a stable code the client can present" */
    it("refuses with the one handled code, permission and tier in meta", async () => {
      resolveProjectPermission.mockResolvedValue({
        permitted: false,
        organizationRole: "MEMBER",
      });
      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(
          paramsFor({ projectId: "proj-1" }) as any,
        ),
      );
      expect(error.cause).toBeInstanceOf(PermissionDeniedError);
      const cause = error.cause as PermissionDeniedError;
      expect(cause.code).toBe("permission_denied");
      expect(cause.meta).toMatchObject({
        permission: "traces:view",
        scopeType: "project",
      });
    });

    /** @scenario "A scope id that resolves to nothing is denied like one the caller may not touch" */
    it("answers an unknown id identically to a denied one", async () => {
      resolveProjectPermission.mockResolvedValue({
        permitted: false,
        organizationRole: null,
      });
      const denied = await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(
          paramsFor({ projectId: "does-not-exist" }) as any,
        ),
      );
      expect((denied.cause as PermissionDeniedError).code).toBe("permission_denied");
      expect(denied.message).not.toContain("does-not-exist");
    });

    /** @scenario "A lite member's denial is distinguishable from a missing grant" */
    it("carries the lite-member restriction for an EXTERNAL caller", async () => {
      resolveTeamPermission.mockResolvedValue({
        permitted: false,
        organizationRole: "EXTERNAL",
      });
      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "team:manage" })(
          paramsFor({ teamId: "team-1" }) as any,
        ),
      );
      expect(error.cause).toBeInstanceOf(LiteMemberRestrictedError);
    });

    it("preserves the membership-disabled cause from the decision", async () => {
      resolveProjectPermission.mockResolvedValue({
        permitted: false,
        organizationRole: null,
        denialReason: "membership-disabled",
      });

      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "traces:view" })(
          paramsFor({ projectId: "proj-1" }) as never,
        ),
      );

      expect(error.cause).toBeInstanceOf(MembershipDisabledError);
      expect((error.cause as MembershipDisabledError).code).toBe("membership_disabled");
    });

    it("denies at the organization tier without a lite-member special case", async () => {
      hasOrganizationPermission.mockResolvedValue(false);
      const error = await rejection(() =>
        checkDeclaredPermission({ permission: "organization:manage" })(
          paramsFor({ organizationId: "org-1" }) as any,
        ),
      );
      expect((error.cause as PermissionDeniedError).code).toBe("permission_denied");
    });
  });
});

describe("checkDeclaredPermissionAny", () => {
  /** @scenario "Any one of several declared permissions is enough" */
  it("permits on the resolver's any-of answer and names the first permission when denied", async () => {
    const params = paramsFor({ projectId: "proj-1" });
    await checkDeclaredPermissionAny(["traces:view", "scenarios:view"])(params as any);
    expect(resolveProjectPermissionAny).toHaveBeenCalledWith(
      expect.objectContaining({
        session: { user: { id: "alice" }, expires: "" },
      }),
      "proj-1",
      ["traces:view", "scenarios:view"],
    );
    expect(params.ctx.permissionChecked).toBe(true);

    resolveProjectPermissionAny.mockResolvedValue({
      permitted: false,
      organizationRole: "MEMBER",
    });
    const error = await rejection(() =>
      checkDeclaredPermissionAny(["traces:view", "scenarios:view"])(
        paramsFor({ projectId: "proj-1" }) as any,
      ),
    );
    expect((error.cause as PermissionDeniedError).meta).toMatchObject({
      permission: "traces:view",
    });
  });

  it("preserves a membership-disabled cause from an any-of decision", async () => {
    resolveProjectPermissionAny.mockResolvedValue({
      permitted: false,
      organizationRole: null,
      denialReason: "membership-disabled",
    });

    const error = await rejection(() =>
      checkDeclaredPermissionAny(["traces:view", "scenarios:view"])(
        paramsFor({ projectId: "proj-1" }) as never,
      ),
    );

    expect(error.cause).toBeInstanceOf(MembershipDisabledError);
    expect((error.cause as MembershipDisabledError).code).toBe("membership_disabled");
  });

  /** @scenario "A blank project id on a multi-permission check is answered the same way" */
  it("answers a blank project id as invalid input, not an internal error", async () => {
    const error = await rejection(() =>
      checkDeclaredPermissionAny(["traces:view", "scenarios:view"])(
        paramsFor({ projectId: "" }) as any,
      ),
    );

    expect(error.code).toBe("BAD_REQUEST");
    expect(error.cause).toBeInstanceOf(BlankScopeIdError);
    expect(resolveProjectPermissionAny).not.toHaveBeenCalled();
    expect(loggedError).not.toHaveBeenCalled();
  });
});

describe("declaredNoPermission", () => {
  /** @scenario "Opting out of permission checks requires a written reason" */
  it("runs for any authenticated caller and records its reason", async () => {
    const middleware = declaredNoPermission({
      reason: "user-scoped preferences only",
    });
    const params = paramsFor({});
    await middleware(params as any);
    expect(params.ctx.permissionChecked).toBe(true);
    expect(authzDeclarationOf(middleware)).toMatchObject({
      kind: "no-permission",
      reason: "user-scoped preferences only",
    });
  });

  /** @scenario "An opted-out procedure cannot silently read scoped input" */
  it("still refuses an unallowed scope id at runtime, defense in depth", async () => {
    const middleware = declaredNoPermission({ reason: "nothing scoped" });
    await expect(middleware(paramsFor({ projectId: "proj-1" }) as any)).rejects.toThrow(
      "projectId is not allowed",
    );
    await expect(
      declaredNoPermission({
        reason: "creation flow",
        allow: { organizationId: "creating inside this organization" },
      })(paramsFor({ organizationId: "org-1" }) as any),
    ).resolves.toBe("next-called");
  });
});

describe("declaredServiceAuthorization", () => {
  /** @scenario "A service-authorized procedure declares the permissions its service enforces" */
  it("marks the check as deferred and names the enforced permissions", async () => {
    const middleware = declaredServiceAuthorization({
      reason: "the row's own scope set decides",
      permissions: ["traces:view"],
    });
    const params = paramsFor({});
    await middleware(params as any);
    expect(params.ctx.permissionChecked).toBe(true);
    expect(authzDeclarationOf(middleware)).toMatchObject({
      kind: "service-authorized",
      permissions: ["traces:view"],
    });
  });
});
