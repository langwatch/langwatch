import { bindTrpcFact, createTrpcRuntime } from "@langwatch/api/trpc";
/**
 * The app's virtual-key create over the real application on its memory twins: the dialog keeps
 * the secret, and a reveal id parked beside it carries the same secret to the Langy card.
 * @vitest-environment node
 * @see specs/langy/langy-secret-snippet.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { SecretApi, StashRevealInput } from "@langwatch/secret-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { GatewayModule } from "../../app/gateway.app.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { MemoryGatewayStore } from "../../repositories/memory/memory.gateway.store.ts";
import { gatewaySessionFact, virtualKeyTrpcTransport } from "../virtual-key.trpc.ts";

type TrpcTestContext = { actor: { id: string } };

const ORGANIZATION_ID = "org_1";
const PROJECT_ID = "project_1";

const secrets = new ScopedSecrets(async (handle, build) =>
  build(handle.id === "LW_VIRTUAL_KEY_PEPPER" ? "test-virtual-key-pepper" : undefined),
);

/** The create procedure over the real gateway, with a recording reveal store. */
async function mountedCreate({ stashed }: { stashed: StashRevealInput[] }) {
  const store = MemoryGatewayStore.create({
    teams: [{ id: "team_1", organizationId: ORGANIZATION_ID, name: "Platform", slug: "platform" }],
  });
  const { repositories } = new MemoryGatewayRepositories(store);
  const project = {
    id: PROJECT_ID,
    teamId: "team_1",
    archivedAt: null,
  };
  const app = await GatewayModule.create({
    dependencies: {
      authz: createApiFixture<AuthzApi>({ hasPermission: async () => true }),
      projects: createApiFixture<ProjectApi>({
        findOrganizationId: async () => ORGANIZATION_ID,
        findIdentity: async (id) => ({
          id,
          name: id,
          slug: id,
          teamId: "team_1",
          organizationId: ORGANIZATION_ID,
          isPersonal: false,
          ownerUserId: null,
        }),
        listIdsByOrganization: async () => [PROJECT_ID],
        listTraceDestinations: async () => [project],
        resolveTraceDestination: async () => ({ outcome: "resolved", project }),
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture({}),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture<SecretApi>({
        stashReveal: async (input) => {
          stashed.push(input);
          return { revealId: "rvl_content_marker" };
        },
      }),
      apiKeys: createApiFixture({}),
    },
    repositories,
    config: {
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: "https://app.acme.example",
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets,
  });
  const trpc = initTRPC.context<TrpcTestContext>().create();
  const router = createTrpcRuntime<TrpcTestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TrpcTestContext>(),
  }).mount(virtualKeyTrpcTransport, () => app, {
    facts: [bindTrpcFact(gatewaySessionFact, (ctx) => ({ user: { id: ctx.actor.id } }))],
  });

  return router.createCaller({ actor: { id: "usr_1" } });
}

describe("virtualKeys.create with revealOnce", () => {
  describe("given a member who manages the project", () => {
    /** @scenario "The tRPC create with revealOnce keeps the secret and adds the reveal id" */
    it("answers with the secret, the reveal id and the prefix, and parks the same secret", async () => {
      const stashed: StashRevealInput[] = [];
      const caller = await mountedCreate({ stashed });

      const created = await caller.create({
        organizationId: ORGANIZATION_ID,
        name: "production-app",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
        revealOnce: true,
      });

      expect(created.secret).toMatch(/^vk-lw-/);
      expect(created.revealId).toBe("rvl_content_marker");
      expect(created.preview).toEqual(expect.any(String));
      expect(stashed).toHaveLength(1);
      expect(stashed[0]).toMatchObject({
        organizationId: ORGANIZATION_ID,
        kind: "virtual_key",
        keyId: created.virtualKey.id,
        preview: created.preview,
        secret: created.secret,
      });
    });

    it("answers with the secret alone, and parks nothing, when revealOnce is not set", async () => {
      const stashed: StashRevealInput[] = [];
      const caller = await mountedCreate({ stashed });

      const created = await caller.create({
        organizationId: ORGANIZATION_ID,
        name: "production-app",
        scopes: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }],
      });

      expect(created.secret).toMatch(/^vk-lw-/);
      expect(created.revealId).toBeUndefined();
      expect(stashed).toHaveLength(0);
    });
  });
});
