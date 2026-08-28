import {
  PermissionDeniedError,
  type AuthzPermission,
  type AuthzScopeLineageInput,
  type AuthzScopeLineageResult,
} from "@langwatch/authz-contract";
import { TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";
import {
  ApiAuthenticationPort,
  ApiAuditPort,
  ApiAuthorizationPort,
  ApiRequestPolicy,
} from "../src/api-request.policy";

class TestAuthentication extends ApiAuthenticationPort {
  constructor(private readonly actor: { id: string } | null) {
    super();
  }

  readonly authenticate = vi.fn(async (_request: Request) => this.actor);
}

class TestAuthorization extends ApiAuthorizationPort {
  readonly can = vi.fn(
    async (_input: { userId: string; permission: AuthzPermission; projectId: string }) => true,
  );
  readonly authorizeProject = vi.fn(
    async (_input: { userId: string; permission: AuthzPermission; projectId: string }) => undefined,
  );
  readonly checkScopeLineage = vi.fn(
    async (_input: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult> => ({
      kind: "consistent",
    }),
  );
}

class TestAudit extends ApiAuditPort {
  readonly record = vi.fn(async (_event) => undefined);
}

describe("ApiRequestPolicy", () => {
  it("injects the authenticated actor and delegates project checks to the named AuthZ port", async () => {
    const authentication = new TestAuthentication({ id: "user-1" });
    const authorization = new TestAuthorization();
    const policy = ApiRequestPolicy.create({ authentication, authorization });
    const context = await policy.createContext(new Request("https://api.example.test/api/trpc"));

    expect(context.actor()).toEqual({ id: "user-1" });
    await expect(context.can?.("secrets:view", { projectId: "project-1" })).resolves.toBe(true);
    await context.authorize("secrets:manage", { projectId: "project-1" });

    expect(authorization.can).toHaveBeenCalledWith({
      userId: "user-1",
      permission: "secrets:view",
      projectId: "project-1",
    });
    expect(authorization.authorizeProject).toHaveBeenCalledWith({
      userId: "user-1",
      permission: "secrets:manage",
      projectId: "project-1",
    });
  });

  it("keeps an unauthenticated request unauthorized instead of inventing an actor", async () => {
    const policy = ApiRequestPolicy.create({
      authentication: new TestAuthentication(null),
      authorization: new TestAuthorization(),
    });
    const context = await policy.createContext(new Request("https://api.example.test/api/trpc"));

    expect(() => context.actor()).toThrow(TRPCError);
    expect(() => context.actor()).toThrow(expect.objectContaining({ code: "UNAUTHORIZED" }));
  });

  it("refuses scope-lineage mismatches before a feature adapter can dispatch", async () => {
    const authorization = new TestAuthorization();
    authorization.checkScopeLineage.mockResolvedValueOnce({
      kind: "mismatch",
      widest: { tier: "organization", id: "organization-1" },
      entries: [],
    });
    const policy = ApiRequestPolicy.create({
      authentication: new TestAuthentication({ id: "user-1" }),
      authorization,
    });
    const context = await policy.createContext(new Request("https://api.example.test/api/trpc"));

    await expect(
      context.authorizeScopeLineage?.(
        { projectId: "project-1", sourceProjectId: "project-2" },
        "evaluations:manage",
      ),
    ).rejects.toBeInstanceOf(PermissionDeniedError);
  });

  it("exposes its audit port through the HTTP options exactly once", async () => {
    const audit = new TestAudit();
    const policy = ApiRequestPolicy.create({
      authentication: new TestAuthentication({ id: "user-1" }),
      authorization: new TestAuthorization(),
      audit,
    });

    const http = policy.asHttpOptions();
    await http.audit?.({ actorId: "user-1", path: "secrets.create", input: {}, error: null });

    expect(audit.record).toHaveBeenCalledWith({
      actorId: "user-1",
      path: "secrets.create",
      input: {},
      error: null,
    });
  });
});
