/**
 * @vitest-environment node
 * The `modelProvider.*` procedures over the real runtime and application.
 * @see specs/model-providers/provider-configuration.feature
 * @see specs/settings/model-provider-skip-permissions.feature
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { initTRPC } from "@trpc/server";
import { describe, expect, it, vi } from "vitest";

import { modelProviderTrpcTransport } from "../model-provider.trpc.ts";
import type { CodexAccountService } from "../../adapters/codex-oauth.model-provider-token-refresher.adapter.ts";
import {
  mountableModelProviderApp,
  modelProviderTrpcTestPorts,
  RecordingCredentialProbe,
  StubCodexAccounts,
  type ModelProviderTestDecision,
  type ModelProviderTrpcTestContext,
} from "./model-provider.harness.ts";

const PROJECT_A = "project_a";

const CODEX_KEYS = {
  CODEX_ACCESS_TOKEN: "access-token-secret",
  CODEX_REFRESH_TOKEN: "refresh-token-secret",
  CODEX_ID_TOKEN: "id-token",
  CODEX_ACCOUNT_ID: "acct_1",
  CODEX_PLAN: "plus",
  CODEX_EMAIL: "person@example.com",
  CODEX_TOKENS_SAVED_AT: "2026-01-01T00:00:00.000Z",
};

const storedProvider = (overrides: Record<string, unknown> = {}) => ({
  id: "mp_openai",
  provider: "openai",
  name: "OpenAI",
  enabled: true,
  disabledAt: null,
  healthStatus: null,
  customKeys: { OPENAI_API_KEY: "**redacted**" },
  scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_A }],
  models: null,
  embeddingsModels: null,
  customModels: [],
  customEmbeddingsModels: [],
  ...overrides,
});

function mount(
  options: {
    modelProviders?: Partial<ModelProviderApi>;
    permits?: ModelProviderTestDecision;
    probe?: RecordingCredentialProbe;
    codexAccounts?: CodexAccountService;
    userId?: string;
  } = {},
) {
  const { app, probe, repositories } = mountableModelProviderApp({
    modelProviders: options.modelProviders ?? {},
    permits: options.permits,
    probe: options.probe,
    codexAccounts: options.codexAccounts,
  });

  const trpc = initTRPC.context<ModelProviderTrpcTestContext>().create();
  const router = createTrpcRuntime<ModelProviderTrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    ports: modelProviderTrpcTestPorts(options.permits ?? (() => true)),
  }).mount(modelProviderTrpcTransport, () => app);

  return {
    router,
    probe,
    repositories,
    caller: router.createCaller({ actor: { id: options.userId ?? "user_a" } }),
  };
}

describe("the modelProvider tRPC namespace", () => {
  describe("given the mounted router", () => {
    it("exposes exactly the procedure names the clients call", () => {
      const { router } = mount();

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
  });

  describe("given a caller who does not hold project:view on the project", () => {
    describe("when they list that project's providers", () => {
      /** @scenario A user without project view permission cannot list a project's providers */
      it("refuses before the gateway is reached", async () => {
        const getForProject = vi.fn(async () => ({}));
        const { caller } = mount({
          modelProviders: { getForProject: getForProject as never },
          permits: (permission) => permission !== "project:view",
        });

        await expect(caller.getAllForProject({ projectId: PROJECT_A })).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        expect(getForProject).not.toHaveBeenCalled();
      });
    });

    describe("when the same caller holds it", () => {
      it("answers, proving the refusal above is not vacuous", async () => {
        const { caller } = mount({
          modelProviders: { getForProject: (async () => ({ openai: storedProvider() })) as never },
        });

        const providers = await caller.getAllForProject({ projectId: PROJECT_A });

        expect(providers.openai?.id).toBe("mp_openai");
      });
    });
  });

  describe("when a project's providers are read", () => {
    it("answers the wire shape, with every unset field travelling as null", async () => {
      const { caller } = mount({
        modelProviders: {
          getForProject: (async () => ({
            openai: storedProvider({
              customModels: [{ id: "my-model", label: "My Model", type: "chat" }],
              models: ["gpt-5"],
            }),
          })) as never,
        },
      });

      const result = await caller.getAllForProject({ projectId: PROJECT_A });

      expect(result.openai).toEqual({
        id: "mp_openai",
        provider: "openai",
        name: "OpenAI",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_A }],
        enabled: true,
        // Absent on the row means "never withdrawn" and "not yet probed"; both
        // travel as null so the browser reads an answer rather than a gap.
        disabledAt: null,
        healthStatus: null,
        customKeys: { OPENAI_API_KEY: "**redacted**" },
        deploymentMapping: null,
        models: ["gpt-5"],
        embeddingsModels: null,
        customModels: [{ modelId: "my-model", displayName: "My Model", mode: "chat" }],
        customEmbeddingsModels: [],
        langySkipPermissionsModels: null,
        rateLimitRpm: null,
        rateLimitTpm: null,
        rateLimitRpd: null,
        fallbackPriorityGlobal: null,
        providerConfig: null,
      });
    });
  });

  describe("when any browser-facing read runs", () => {
    /** @scenario Plaintext API keys never reach the browser through any provider query */
    it("uses the masking operations, never the decrypted execution one", async () => {
      const getForProject = vi.fn(async () => ({}));
      const listForProject = vi.fn(async () => []);
      const listForOrganization = vi.fn(async () => []);
      const getExecutionProviders = vi.fn(async () => ({}));
      const { caller } = mount({
        modelProviders: {
          getForProject: getForProject as never,
          listForProject: listForProject as never,
          listForOrganization: listForOrganization as never,
          getExecutionProviders: getExecutionProviders as never,
        },
      });

      await caller.getAllForProject({ projectId: PROJECT_A });
      await caller.getAllForProjectForFrontend({ projectId: PROJECT_A });
      await caller.listAllForProjectForFrontend({ projectId: PROJECT_A });
      await caller.listAllForOrganizationForFrontend({ organizationId: "org-1" });

      expect(getForProject).toHaveBeenCalledTimes(2);
      expect(listForProject).toHaveBeenCalledTimes(1);
      expect(listForOrganization).toHaveBeenCalledTimes(1);
      // The one that hands back decrypted credentials. A tRPC answer lands in a
      // browser, so no procedure here may reach for it.
      expect(getExecutionProviders).not.toHaveBeenCalled();
    });
  });

  describe("when the drawer saves a provider", () => {
    /** @scenario "A stored list replaces the provider default" */
    it("forwards the Langy skip-permissions list to the write", async () => {
      const upsert = vi.fn(async () => storedProvider());
      const { caller } = mount({ modelProviders: { upsert: upsert as never } });

      await caller.update({
        id: "mp_openai",
        projectId: PROJECT_A,
        provider: "openai",
        enabled: true,
        langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
      });

      expect(upsert.mock.calls[0]?.[0]).toMatchObject({
        langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
      });
    });

    /** @scenario "Clearing the list returns the provider to its default" */
    it("forwards an emptied list rather than dropping the field", async () => {
      const upsert = vi.fn(async () => storedProvider());
      const { caller } = mount({ modelProviders: { upsert: upsert as never } });

      await caller.update({
        id: "mp_openai",
        projectId: PROJECT_A,
        provider: "openai",
        enabled: true,
        langySkipPermissionsModels: [],
      });

      expect(upsert.mock.calls[0]?.[0]).toMatchObject({ langySkipPermissionsModels: [] });
    });

    it("folds the legacy single-scope fields into the canonical scopes list", async () => {
      const upsert = vi.fn(async () => storedProvider());
      const { caller } = mount({ modelProviders: { upsert: upsert as never } });

      await caller.update({
        projectId: PROJECT_A,
        provider: "openai",
        enabled: true,
        scopeType: "TEAM",
        scopeId: "team-1",
      });

      expect(upsert.mock.calls[0]?.[0]).toMatchObject({
        scopes: [{ scopeType: "TEAM", scopeId: "team-1" }],
      });
      expect(upsert.mock.calls[0]?.[1]).toMatchObject({ id: "user_a" });
    });
  });

  describe("when a stored provider is listed back", () => {
    /** @scenario "A saved gateway rate limit reopens as saved" */
    it("carries the stored skip list and the gateway knobs on both projections", async () => {
      const saved = storedProvider({
        langySkipPermissionsModels: ["^gpt-9$"],
        rateLimitRpm: 600,
        fallbackPriorityGlobal: 1,
        providerConfig: { region: "us-east-1" },
      });
      const { caller } = mount({
        modelProviders: {
          getForProject: (async () => ({ openai: saved })) as never,
          listForProject: (async () => [saved]) as never,
        },
      });

      const map = await caller.getAllForProject({ projectId: PROJECT_A });
      const list = await caller.listAllForProjectForFrontend({ projectId: PROJECT_A });

      expect(map.openai?.langySkipPermissionsModels).toEqual(["^gpt-9$"]);
      expect(map.openai?.rateLimitRpm).toBe(600);
      expect(map.openai?.rateLimitTpm).toBeNull();
      expect(map.openai?.providerConfig).toEqual({ region: "us-east-1" });
      expect(list[0]?.fallbackPriorityGlobal).toBe(1);
    });
  });

  describe("when a write names neither a project nor an organization", () => {
    it("refuses before the gateway is reached", async () => {
      const upsert = vi.fn();
      const { caller } = mount({ modelProviders: { upsert: upsert as never } });

      await expect(caller.update({ provider: "openai", enabled: true })).rejects.toMatchObject({
        code: "BAD_REQUEST",
      });
      expect(upsert).not.toHaveBeenCalled();
    });
  });

  describe("given a caller who may not write the tenant they named", () => {
    describe("when they probe a credential they typed", () => {
      /** @scenario A credential probe is refused for a caller who cannot write the tenant */
      it("refuses before anything leaves this process", async () => {
        const probe = RecordingCredentialProbe.create({ outcome: "verified", valid: true });
        const { caller } = mount({ probe, permits: () => false });

        await expect(
          caller.validateApiKey({
            projectId: PROJECT_A,
            provider: "openai",
            customKeys: { OPENAI_API_KEY: "sk-typed-by-the-customer" },
          }),
        ).rejects.toBeDefined();
        expect(probe.probed).toEqual([]);
      });
    });

    describe("when the same caller may write it", () => {
      it("hands the caller's keys to the probe unchanged", async () => {
        const probe = RecordingCredentialProbe.create({ outcome: "verified", valid: true });
        const { caller } = mount({ probe });

        const verdict = await caller.validateApiKey({
          projectId: PROJECT_A,
          provider: "openai",
          customKeys: { OPENAI_API_KEY: "sk-typed-by-the-customer" },
        });

        expect(verdict).toEqual({ outcome: "verified", valid: true });
        expect(probe.probed).toEqual([
          { provider: "openai", customKeys: { OPENAI_API_KEY: "sk-typed-by-the-customer" } },
        ]);
      });
    });
  });

  describe("given a Codex device authorization that is still pending", () => {
    describe("when the browser polls it", () => {
      it("answers pending and stores nothing", async () => {
        const upsert = vi.fn();
        const { caller } = mount({
          modelProviders: { upsert: upsert as never },
          codexAccounts: StubCodexAccounts.create({ status: "pending" }),
        });

        const result = await caller.codexSignInPoll({
          projectId: PROJECT_A,
          deviceAuthId: "auth-1",
          userCode: "ABCD-EFGH",
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_A }],
        });

        expect(result).toEqual({ status: "pending" });
        expect(upsert).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a Codex device authorization the person has approved", () => {
    describe("when the browser polls it", () => {
      it("saves the credential and answers the account, with no token on the wire", async () => {
        const upsert = vi.fn(async () => ({ id: "mp_codex" }));
        const setDefault = vi.fn(async () => {});
        const { caller } = mount({
          modelProviders: { upsert: upsert as never, setDefault: setDefault as never },
          codexAccounts: StubCodexAccounts.create({ status: "complete", keys: CODEX_KEYS }),
        });

        const result = await caller.codexSignInPoll({
          projectId: PROJECT_A,
          deviceAuthId: "auth-1",
          userCode: "ABCD-EFGH",
          scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_A }],
        });

        expect(result).toEqual({
          status: "complete",
          providerId: "mp_codex",
          email: "person@example.com",
          plan: "plus",
        });
        expect(JSON.stringify(result)).not.toContain("access-token-secret");
        // Not asked for, so the coding roles stay where they were.
        expect(setDefault).not.toHaveBeenCalled();
      });

      it("points only the LANGY and FAST roles at the codex model when asked", async () => {
        const { caller, repositories } = mount({
          modelProviders: { upsert: (async () => ({ id: "mp_codex" })) as never },
          codexAccounts: StubCodexAccounts.create({ status: "complete", keys: CODEX_KEYS }),
        });

        await caller.codexSignInPoll({
          projectId: PROJECT_A,
          deviceAuthId: "auth-1",
          userCode: "ABCD-EFGH",
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
          setAsCodingDefaults: true,
        });

        const stored = await repositories.defaults.tryFindByScope({
          scopeType: "ORGANIZATION",
          scopeId: "org-1",
        });

        // The Default role - playground, evaluators, workflows - is untouched:
        // those are not coding surfaces.
        expect(Object.keys(stored?.config ?? {}).sort()).toEqual(["FAST", "LANGY"]);
      });
    });
  });
});
