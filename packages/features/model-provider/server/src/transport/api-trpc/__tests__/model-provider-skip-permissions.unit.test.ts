/**
 * The skip-permissions list crosses the tRPC write and read paths.
 *
 * The drawer sends the list on the same Save as the rest of the provider, so a
 * transport that accepts the field and drops it on the floor looks exactly like
 * one that saved it — until the drawer reopens on the registry default. This
 * suite holds both halves: the input reaches `upsert`, and the list projection
 * carries the stored list back.
 *
 * @vitest-environment node
 * @see specs/settings/model-provider-skip-permissions.feature
 */
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { ModelProviderTrpcApi, type ModelProviderTrpcContext } from "../model-provider.api";

const PROJECT_A = "project_a";

type TestContext = ModelProviderTrpcContext & { userId: string };

function harness(options: { stored?: string[] | null } = {}) {
  const trpc = initTRPC.context<TestContext>().create();
  const upserts: unknown[] = [];

  const saved = {
    id: "mp_openai",
    provider: "openai",
    name: "OpenAI",
    enabled: true,
    disabledAt: null,
    healthStatus: null,
    customKeys: null,
    scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_A }],
    models: null,
    embeddingsModels: null,
    customModels: [],
    customEmbeddingsModels: [],
    langySkipPermissionsModels: options.stored ?? null,
  };

  const router = ModelProviderTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy: () => (p: unknown) => p,
      tenantWritePolicy: () => (p: unknown) => p,
      credentialProbePolicy: (p: unknown) => p,
      serviceAuthorizedPolicy: () => (p: unknown) => p,
    } as never,
    {
      validateProviderApiKey: async () => ({ valid: true }) as never,
      validateKeyWithCustomUrl: async () => ({ valid: true }) as never,
    } as never,
  );

  const caller = router.createCaller({
    userId: "user_a",
    app: {
      modelProviders: {
        upsert: async (input: unknown) => {
          upserts.push(input);
          return saved;
        },
        getForProject: async () => ({ openai: saved }),
      },
    },
    actor: () => ({ id: "user_a" }),
  } as never);

  return { caller, upserts };
}

describe("modelProvider.update — the Langy skip-permissions list", () => {
  describe("when the drawer sends a list of patterns", () => {
    /** @scenario "A stored list replaces the provider default" */
    it("forwards it to the service write", async () => {
      const { caller, upserts } = harness();

      await caller.update({
        id: "mp_openai",
        projectId: PROJECT_A,
        provider: "openai",
        enabled: true,
        langySkipPermissionsModels: ["^gpt-9$", "^gpt-10$"],
      });

      expect(
        (upserts[0] as { langySkipPermissionsModels: unknown }).langySkipPermissionsModels,
      ).toEqual(["^gpt-9$", "^gpt-10$"]);
    });
  });

  describe("when the drawer clears the field", () => {
    /** @scenario "Clearing the list returns the provider to its default" */
    it("forwards the empty list rather than dropping the field", async () => {
      const { caller, upserts } = harness();

      await caller.update({
        id: "mp_openai",
        projectId: PROJECT_A,
        provider: "openai",
        enabled: true,
        langySkipPermissionsModels: [],
      });

      expect(
        (upserts[0] as { langySkipPermissionsModels: unknown }).langySkipPermissionsModels,
      ).toEqual([]);
    });
  });

  describe("when the stored provider is listed back", () => {
    /** @scenario "A stored list replaces the provider default" */
    it("carries the stored list on the list projection", async () => {
      const { caller } = harness({ stored: ["^gpt-9$"] });

      const providers = await caller.getAllForProject({ projectId: PROJECT_A });

      expect(providers.openai?.langySkipPermissionsModels).toEqual(["^gpt-9$"]);
    });
  });
});
