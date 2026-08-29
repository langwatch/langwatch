/**
 * @vitest-environment node
 *
 * The tRPC surface itself: the procedure names the clients call, the
 * declarations the four service-authorized writes carry, the order the
 * process policy is applied in relative to the input parser, and the wire
 * shapes the handlers build.
 *
 * The policy is injected here as a recorder rather than the process's real
 * chain, which is what lets the ordering rule be asserted directly: a check
 * installed before `.input()` reads `undefined`, so every declaration that
 * resolves a scope id from the input would fail open.
 */
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { ModelProviderApp } from "../model-provider.app";
import { ModelProviderTrpcApi } from "../../transport/api-trpc/model-provider.api";

type TestContext = {
  app: { modelProviders: ModelProviderApp };
  actor(): { id: string };
  session: { user: { id: string } } | null;
};

function serviceStub(overrides: Partial<ModelProviderService>): ModelProviderService {
  return overrides as unknown as ModelProviderService;
}

const codexKeys = {
  CODEX_ACCESS_TOKEN: "access-token-secret",
  CODEX_REFRESH_TOKEN: "refresh-token-secret",
  CODEX_ID_TOKEN: "id-token",
  CODEX_ACCOUNT_ID: "acct_1",
  CODEX_PLAN: "plus",
  CODEX_EMAIL: "person@example.com",
  CODEX_TOKENS_SAVED_AT: "2026-01-01T00:00:00.000Z",
};

function harness({
  modelProviders = {} as Partial<ModelProviderService>,
  pollResult = { status: "pending" as const } as
    | { status: "pending" }
    | { status: "complete"; keys: typeof codexKeys },
}: {
  modelProviders?: Partial<ModelProviderService>;
  pollResult?: { status: "pending" } | { status: "complete"; keys: typeof codexKeys };
} = {}) {
  const recordAudit = vi.fn();
  const validateProviderApiKey = vi.fn(async () => ({ outcome: "verified", valid: true }));
  const validateKeyWithCustomUrl = vi.fn(async () => ({ outcome: "verified", valid: true }));
  const startCodexDeviceSignIn = vi.fn(async () => ({ userCode: "ABCD-EFGH" }));
  const pollCodexDeviceSignIn = vi.fn(async () => pollResult);

  /** Every input the policy middleware saw, keyed by nothing — order only. */
  const inputsSeenByPolicy: unknown[] = [];
  const serviceDeclarations: Array<{
    reason: string;
    permissions: readonly string[];
  }> = [];
  const permissions: string[] = [];

  const trpc = initTRPC.context<TestContext>().create();
  // Mirrors the process's authenticated procedure: it narrows the context, so
  // the builder handed over is not the root's bare one.
  const authenticated = trpc.procedure.use(({ ctx, next }) => {
    if (!ctx.session) throw new TRPCError({ code: "UNAUTHORIZED" });
    return next({ ctx: { session: { user: ctx.session.user } } });
  });

  const recorder =
    () =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use(({ input, next }: any) => {
        inputsSeenByPolicy.push(input);
        return next();
      }) as TProcedure;

  const router = ModelProviderTrpcApi.create(
    trpc,
    {
      protected: authenticated,
      policy: (permission) => {
        permissions.push(permission);
        return recorder();
      },
      tenantWritePolicy: (permission) => {
        permissions.push(permission);
        return recorder();
      },
      credentialProbePolicy: recorder(),
      serviceAuthorizedPolicy: (options) => {
        serviceDeclarations.push(options);
        return recorder();
      },
    },
    {
      validateProviderApiKey,
      validateKeyWithCustomUrl,
      startCodexDeviceSignIn,
      pollCodexDeviceSignIn,
      recordAudit,
    },
  );

  return {
    router,
    recordAudit,
    validateProviderApiKey,
    validateKeyWithCustomUrl,
    pollCodexDeviceSignIn,
    inputsSeenByPolicy,
    serviceDeclarations,
    permissions,
    caller: router.createCaller({
      app: {
        modelProviders: ModelProviderApp.create({
          modelProviders: serviceStub(modelProviders),
          // The cost surface's reader, carried opaquely; no procedure under
          // test here reaches it.
          spans: {},
        }),
      },
      actor: () => ({ id: "user-1" }),
      session: { user: { id: "user-1" } },
    }),
  };
}

describe("ModelProviderTrpcApi", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = harness();

      expect(Object.keys(router._def.procedures).sort()).toEqual([
        "codexApplyCodingDefaults",
        "codexSignInPoll",
        "codexSignInStart",
        "codexStatus",
        "delete",
        "deleteDefaultModelsConfig",
        "getAllForProject",
        "getAllForProjectForFrontend",
        "getDefaultModelsForProject",
        "getInheritedValuesForScopes",
        "getResolvedDefault",
        "isManagedProvider",
        "listAllForOrganizationForFrontend",
        "listAllForProjectForFrontend",
        "saveDefaultModelsConfig",
        "setFeatureOverrideForScope",
        "setRoleAssignmentForScope",
        "testConnection",
        "update",
        "validateApiKey",
        "validateKeyWithCustomUrl",
      ]);
    });

    it("declares the permissions the process must check", () => {
      const { permissions } = harness();

      expect(permissions).toEqual([
        "project:view",
        "project:view",
        "project:view",
        "organization:view",
        "project:update",
        "project:delete",
        "project:update",
        "project:update",
        "project:update",
        "project:update",
        "project:view",
        "organization:view",
        "project:update",
        "project:view",
        "project:view",
        "project:view",
      ]);
    });

    it("carries the four service-authorized declarations verbatim", () => {
      const { serviceDeclarations } = harness();

      expect(serviceDeclarations).toEqual([
        {
          reason:
            "the tier is data: the scope the caller names decides the permission, and the service's assertCanWriteDefault is what checks it",
          permissions: ["organization:manage", "team:manage", "project:manage"],
        },
        {
          reason:
            "the tier is data: the scope the caller names decides the permission, and the service's assertCanWriteDefault is what checks it",
          permissions: ["organization:manage", "team:manage", "project:manage"],
        },
        {
          reason:
            "the tier is data: each scope the caller picks decides its own permission, and the service's assertCanWriteDefault is what checks them",
          permissions: ["organization:manage", "team:manage", "project:manage"],
        },
        {
          reason:
            "the scopes are the stored row's, not the caller's input, so only the service can know which permissions to require",
          permissions: ["organization:manage", "team:manage", "project:manage"],
        },
      ]);
    });
  });

  describe("when the process policy runs", () => {
    it("sees the validated input, proving it was applied after the parser", async () => {
      const { caller, inputsSeenByPolicy } = harness({
        modelProviders: {
          getCodexStatus: vi.fn(async () => ({ connected: false })) as never,
        },
      });

      await caller.codexStatus({ projectId: "project-1" });

      expect(inputsSeenByPolicy).toEqual([{ projectId: "project-1" }]);
    });
  });

  describe("when a project's providers are read", () => {
    it("returns the wire shape, keys included exactly as the service masked them", async () => {
      const getForProject = vi.fn(async () => ({
        openai: {
          id: "mp_openai",
          provider: "openai",
          enabled: true,
          customKeys: { OPENAI_API_KEY: "**redacted**" },
          customModels: [{ id: "my-model", label: "My Model", type: "chat" }],
          customEmbeddingsModels: [],
          models: ["gpt-5"],
          embeddingsModels: null,
        },
      }));
      const { caller } = harness({
        modelProviders: { getForProject: getForProject as never },
      });

      const result = await caller.getAllForProject({ projectId: "project-1" });

      expect(result.openai).toEqual({
        id: "mp_openai",
        provider: "openai",
        enabled: true,
        customKeys: { OPENAI_API_KEY: "**redacted**" },
        deploymentMapping: null,
        models: ["gpt-5"],
        embeddingsModels: null,
        customModels: [{ modelId: "my-model", displayName: "My Model", mode: "chat" }],
        customEmbeddingsModels: [],
      });
    });
  });

  describe("when any browser-facing read runs", () => {
    it("uses the masking service methods, never the decrypted execution ones", async () => {
      const getForProject = vi.fn(async () => ({}));
      const listForProject = vi.fn(async () => []);
      const listForOrganization = vi.fn(async () => []);
      const getExecutionProviders = vi.fn(async () => ({}));
      const { caller } = harness({
        modelProviders: {
          getForProject: getForProject as never,
          listForProject: listForProject as never,
          listForOrganization: listForOrganization as never,
          getExecutionProviders: getExecutionProviders as never,
        },
      });

      await caller.getAllForProject({ projectId: "project-1" });
      await caller.getAllForProjectForFrontend({ projectId: "project-1" });
      await caller.listAllForProjectForFrontend({ projectId: "project-1" });
      await caller.listAllForOrganizationForFrontend({ organizationId: "org-1" });

      expect(getForProject).toHaveBeenCalledTimes(2);
      expect(listForProject).toHaveBeenCalledTimes(1);
      expect(listForOrganization).toHaveBeenCalledTimes(1);
      // The one that hands back decrypted credentials. A tRPC response lands
      // in a browser, so no procedure here may reach for it.
      expect(getExecutionProviders).not.toHaveBeenCalled();
    });
  });

  describe("when a provider is written with the legacy single-scope fields", () => {
    it("folds them into the canonical scopes list", async () => {
      const upsert = vi.fn(async (_input: unknown) => ({
        id: "mp_1",
        provider: "openai",
        enabled: true,
        customKeys: null,
        customModels: [],
        customEmbeddingsModels: [],
      }));
      const { caller } = harness({ modelProviders: { upsert: upsert as never } });

      await caller.update({
        projectId: "project-1",
        provider: "openai",
        enabled: true,
        scopeType: "TEAM",
        scopeId: "team-1",
      });

      expect(upsert.mock.calls[0]?.[0]).toMatchObject({
        actorId: "user-1",
        scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
      });
    });
  });

  describe("when a write names neither a project nor an organization", () => {
    it("refuses before the service is reached", async () => {
      const upsert = vi.fn();
      const { caller } = harness({ modelProviders: { upsert: upsert as never } });

      await expect(caller.update({ provider: "openai", enabled: true })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("when the Codex sign-in has not been approved yet", () => {
    it("answers pending without saving anything", async () => {
      const upsert = vi.fn();
      const { caller } = harness({ modelProviders: { upsert: upsert as never } });

      const result = await caller.codexSignInPoll({
        projectId: "project-1",
        deviceAuthId: "auth-1",
        userCode: "ABCD-EFGH",
        scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
      });

      expect(result).toEqual({ status: "pending" });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("when the Codex sign-in completes", () => {
    it("audits the connect without the token set or the account email", async () => {
      const upsert = vi.fn(async (_input: unknown) => ({ id: "mp_codex" }));
      const setDefault = vi.fn(async (_input: { key: string }) => {});
      const { caller, recordAudit } = harness({
        modelProviders: { upsert: upsert as never, setDefault: setDefault as never },
        pollResult: { status: "complete", keys: codexKeys },
      });

      const result = await caller.codexSignInPoll({
        projectId: "project-1",
        deviceAuthId: "auth-1",
        userCode: "ABCD-EFGH",
        scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
      });

      expect(result).toEqual({
        status: "complete",
        providerId: "mp_codex",
        email: "person@example.com",
        plan: "plus",
      });
      expect(recordAudit).toHaveBeenCalledWith({
        userId: "user-1",
        projectId: "project-1",
        action: "modelProvider.codexConnect",
        targetKind: "modelProvider",
        targetId: "mp_codex",
        args: {
          scopes: [{ scopeType: "PROJECT", scopeId: "project-1" }],
          setAsCodingDefaults: false,
          plan: "plus",
        },
      });
      expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("access-token-secret");
      expect(JSON.stringify(recordAudit.mock.calls)).not.toContain("person@example.com");
      // Not asked for, so the coding roles stay where they were.
      expect(setDefault).not.toHaveBeenCalled();
    });

    it("points only the LANGY and FAST roles at the codex model when asked", async () => {
      const setDefault = vi.fn(async (_input: { key: string }) => {});
      const { caller } = harness({
        modelProviders: {
          upsert: vi.fn(async (_input: unknown) => ({ id: "mp_codex" })) as never,
          setDefault: setDefault as never,
        },
        pollResult: { status: "complete", keys: codexKeys },
      });

      await caller.codexSignInPoll({
        projectId: "project-1",
        deviceAuthId: "auth-1",
        userCode: "ABCD-EFGH",
        scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        setAsCodingDefaults: true,
      });

      expect(setDefault.mock.calls.map((call) => call[0].key)).toEqual(["LANGY", "FAST"]);
    });
  });

  describe("when a credential is probed", () => {
    it("hands the caller's keys to the process's probe unchanged", async () => {
      const { caller, validateProviderApiKey } = harness();

      await caller.validateApiKey({
        projectId: "project-1",
        provider: "openai",
        customKeys: { OPENAI_API_KEY: "sk-typed-by-the-customer" },
      });

      expect(validateProviderApiKey).toHaveBeenCalledWith("openai", {
        OPENAI_API_KEY: "sk-typed-by-the-customer",
      });
    });
  });
});
