/**
 * @vitest-environment node
 * Registering an A2A target through `gatewayA2aTargets.*` on the real control plane over its
 * memory twins: what is stored, what the gateways are told, and what each call answers.
 */
import { createTrpcRuntime } from "@langwatch/api/trpc";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { trpcTestMembers } from "@langwatch/test-harness/trpc-members";
import { nowInstant } from "@langwatch/time";
import { initTRPC } from "@trpc/server";
import { describe, expect, it } from "vitest";

import { memoryProjectWithTeam } from "../../__tests__/support/gateway-memory-seeds.fixture.ts";
import { GatewayModule } from "../../app/gateway.app.ts";
import { MemoryGatewayChannels } from "../../channels/memory/memory.gateway.channels.ts";
import { MemoryGatewayRepositories } from "../../repositories/memory/memory.gateway.repositories.ts";
import { gatewayA2aTargetTrpcTransport } from "../gateway-a2a-target.trpc.ts";

type TestContext = { actor: { id: string } };

const ORG_ID = "org_1";
const PROJECT_ID = "p1";
const FOREIGN_PROJECT_ID = "p_other_org";

const registration = {
  organizationId: ORG_ID,
  projectId: PROJECT_ID,
  name: "billing",
  agentName: "Billing agent",
  cardUrl: "https://billing.acme.test/.well-known/agent-card.json",
  upstreamUrl: "https://billing.acme.test/a2a",
  upstreamHeaders: { "X-Billing-Token": "s3cret" },
};

/** No handle is ever resolved through it in these tests. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

function organizationOf(projectId: string): string {
  return projectId === FOREIGN_PROJECT_ID ? "org_2" : ORG_ID;
}

async function controlPlane() {
  const app = await GatewayModule.create({
    channels: MemoryGatewayChannels.create(),
    dependencies: {
      authz: createApiFixture({}),
      projects: createApiFixture<ProjectApi>({
        findWithTeam: async (projectId) =>
          memoryProjectWithTeam({
            projectId,
            teamId: `team_${projectId}`,
            organizationId: organizationOf(projectId),
          }),
        findOrganizationId: async (projectId) => organizationOf(projectId),
      }),
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations: createApiFixture<OrganizationApi>({
        findProvisioningSummary: async (organizationId) => ({
          id: organizationId,
          name: "Organization",
          slug: "organization",
          createdAt: nowInstant(),
        }),
      }),
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
      licensing: createApiFixture({}),
    },
    repositories: MemoryGatewayRepositories.create(),
    config: {
      foldCacheTtlSeconds: 300,
      spendSettlementGraceMs: void 0,
      internalUrl: void 0,
      controlPlaneUrl: void 0,
      publicBaseUrl: void 0,
      baseUrl: void 0,
      publicUrl: void 0,
      isSaas: false,
      allowLoopbackVoiceProviders: false,
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
  });
  const trpc = initTRPC.context<TestContext>().create();
  const router = createTrpcRuntime<TestContext>({
    root: trpc,
    procedure: trpc.procedure,
    members: trpcTestMembers<TestContext>(),
  }).mount(gatewayA2aTargetTrpcTransport, () => app);
  return { app, targets: router.createCaller({ actor: { id: "usr_admin" } }) };
}

describe("gatewayA2aTargets on the control plane", () => {
  describe("when an admin registers a target for a project", () => {
    /** @scenario "targets are registered from the control plane" */
    it("stores it for the project and tells the project's gateways to reload", async () => {
      const { app, targets } = await controlPlane();

      const created = await targets.create(registration);

      expect(created).toMatchObject({
        projectId: PROJECT_ID,
        name: "billing",
        upstreamUrl: registration.upstreamUrl,
        upstreamHeaderNames: ["X-Billing-Token"],
        createdById: "usr_admin",
      });
      expect(JSON.stringify(created)).not.toContain("s3cret");
      expect(
        (await targets.listForProject({ projectId: PROJECT_ID })).map((target) => target.id),
      ).toEqual([created.id]);
      const feed = await app.listChanges(ORG_ID, 0n, 10);
      expect(feed.events.map((event) => [event.kind, event.projectId])).toEqual([
        ["A2A_TARGET_CREATED", PROJECT_ID],
      ]);
    });
  });

  describe("when the target names a project of another organization", () => {
    it("refuses with the scope mismatch code and tells no gateway anything", async () => {
      const { app, targets } = await controlPlane();

      await expect(
        targets.create({ ...registration, projectId: FOREIGN_PROJECT_ID }),
      ).rejects.toMatchObject({ cause: { code: "gateway_scope_org_mismatch" } });
      expect(await targets.list({ organizationId: ORG_ID })).toEqual([]);
      expect((await app.listChanges(ORG_ID, 0n, 10)).events).toEqual([]);
    });
  });

  describe("when an admin archives a target", () => {
    it("answers the archived target with its archive time", async () => {
      const { targets } = await controlPlane();
      const created = await targets.create(registration);

      const archived = await targets.archive({ organizationId: ORG_ID, id: created.id });

      expect(archived.id).toBe(created.id);
      expect(archived.archivedAt).toEqual(expect.any(String));
      expect(Number.isNaN(Date.parse(archived.archivedAt ?? ""))).toBe(false);
      expect(await targets.list({ organizationId: ORG_ID })).toEqual([]);
    });
  });
});
