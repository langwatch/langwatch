/**
 * @vitest-environment node
 *
 * @see specs/model-providers/provider-configuration.feature
 *
 * `modelProvider.getAllForProject`'s tenancy boundary.
 *
 * The route declares `policy("project:view")` — a generic, process-supplied
 * check with no model-provider logic of its own, so this suite injects a
 * `policy` double the way `evaluator-trpc-api.unit.test.ts` does: a real
 * `.use()` middleware, not the production `trpc-runtime-policy` chain (that
 * lives in `@langwatch/api` and is process-composed). What makes it a real
 * check rather than an echo is that its permission decision is COMPUTED from
 * a small in-memory tenancy fixture — project -> team -> organization, and
 * who holds which role where — mirroring what `AuthzService.getDecision`
 * would answer, instead of a stub that returns whatever the test wants.
 */
import { initTRPC, TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import type { AuthzPermission } from "@langwatch/authz-contract";
import { ModelProviderTrpcApi, type ModelProviderTrpcContext } from "../model-provider.api";

const PROJECT_A = "project_a";
const PROJECT_B = "project_b";
const TEAM_A = "team_a";
const TEAM_B = "team_b";
const ORG_A = "org_a";
const ORG_B = "org_b";

const projectTeam: Record<string, string> = { [PROJECT_A]: TEAM_A, [PROJECT_B]: TEAM_B };
const teamOrg: Record<string, string> = { [TEAM_A]: ORG_A, [TEAM_B]: ORG_A };

type Binding = { userId: string; tier: "project" | "organization"; id: string };

/** Real per-user bindings, the way a role-binding table would answer. */
const bindings: Binding[] = [
  { userId: "user_member_of_project_a", tier: "project", id: PROJECT_A },
  // Full admin of a SIBLING project in the same org — must not see project_a.
  { userId: "user_other_project_admin", tier: "project", id: PROJECT_B },
  // Full admin of a DIFFERENT org — must not see anything in org_a.
  { userId: "user_other_org_admin", tier: "organization", id: ORG_B },
];

/** The organization a `project:view` check on `projectId` actually resolves to. */
function organizationOf(projectId: string): string | undefined {
  const team = projectTeam[projectId];
  return team ? teamOrg[team] : undefined;
}

/** Computes whether a user's bindings reach the given project's organization. */
function canViewProject(userId: string, projectId: string): boolean {
  const organizationId = organizationOf(projectId);
  return bindings.some((binding) => {
    if (binding.userId !== userId) return false;
    if (binding.tier === "project") return binding.id === projectId;
    return binding.id === organizationId;
  });
}

type TestContext = ModelProviderTrpcContext & { userId: string };

function harness() {
  const trpc = initTRPC.context<TestContext>().create();
  const policy =
    (permission: AuthzPermission) =>
    <TProcedure>(procedure: TProcedure): TProcedure =>
      (procedure as any).use((options: { ctx: TestContext; input: { projectId: string }; next: () => unknown }) => {
        if (permission !== "project:view") {
          throw new Error(`unexpected permission in this harness: ${permission}`);
        }
        if (!canViewProject(options.ctx.userId, options.input.projectId)) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        return options.next();
      }) as TProcedure;

  const providers = {
    openai: {
      id: "mp_openai",
      provider: "openai",
      name: "OpenAI",
      enabled: true,
      disabledAt: null,
      healthStatus: null,
      customKeys: { OPENAI_API_KEY: "***" },
      scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_A }],
      models: null,
      embeddingsModels: null,
      customModels: [],
      customEmbeddingsModels: [],
    },
  };

  const router = ModelProviderTrpcApi.create(
    trpc,
    {
      protected: trpc.procedure,
      policy,
      tenantWritePolicy: () => (p: unknown) => p,
      credentialProbePolicy: (p: unknown) => p,
      serviceAuthorizedPolicy: () => (p: unknown) => p,
    } as never,
    {
      validateProviderApiKey: async () => ({ valid: true }) as never,
      validateKeyWithCustomUrl: async () => ({ valid: true }) as never,
    } as never,
  );

  function callerFor(userId: string) {
    return router.createCaller({
      userId,
      app: {
        modelProviders: {
          getForProject: async () => providers,
        },
      },
      actor: () => ({ id: userId }),
    } as never);
  }

  return { callerFor };
}

describe("modelProvider.getAllForProject authz", () => {
  describe("when the user has no access to the project at all", () => {
    /** @scenario A user without project view permission cannot list a project's providers */
    it("rejects with FORBIDDEN", async () => {
      const { callerFor } = harness();

      await expect(callerFor("user_with_nothing").getAllForProject({ projectId: PROJECT_A })).rejects.toMatchObject(
        { code: "FORBIDDEN" },
      );
    });
  });

  describe("when the user only has access to a sibling project in the same organization", () => {
    /** @scenario Access to a sibling project does not grant access to this project's providers */
    it("rejects with FORBIDDEN", async () => {
      const { callerFor } = harness();

      await expect(
        callerFor("user_other_project_admin").getAllForProject({ projectId: PROJECT_A }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("when the user is an admin of a different organization", () => {
    /** @scenario Admin rights in another organization grant nothing across the tenancy boundary */
    it("rejects with FORBIDDEN", async () => {
      const { callerFor } = harness();

      await expect(
        callerFor("user_other_org_admin").getAllForProject({ projectId: PROJECT_A }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });
  });

  describe("when the user has a binding on the project itself", () => {
    it("returns providers, proving the denials above are not vacuous", async () => {
      const { callerFor } = harness();

      const result = await callerFor("user_member_of_project_a").getAllForProject({ projectId: PROJECT_A });

      expect(result.openai).toBeDefined();
    });
  });
});
