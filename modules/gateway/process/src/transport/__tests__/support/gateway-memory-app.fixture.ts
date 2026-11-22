/**
 * The gateway application on its memory twins, for transport suites that mount one of its doors.
 * A suite supplies the three peers its scenarios answer; every other peer is an empty fixture.
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";

import { GatewayModule } from "../../../app/gateway.app.ts";
import type { GatewayChannels } from "../../../channels/gateway.channels.ts";
import type { GatewayRepositories } from "../../../repositories/gateway.repositories.ts";

/** Boots the gateway application over the given channels and repositories, with no secrets. */
export function memoryGatewayApp({
  channels,
  repositories,
  authz,
  projects,
  organizations,
}: {
  channels: GatewayChannels;
  repositories: GatewayRepositories;
  authz: AuthzApi;
  projects: ProjectApi;
  organizations: OrganizationApi;
}): Promise<GatewayModule> {
  return GatewayModule.create({
    channels,
    dependencies: {
      authz,
      projects,
      evaluators: createApiFixture({}),
      evaluations: createApiFixture({}),
      monitors: createApiFixture({}),
      organizations,
      featureFlags: createApiFixture({}),
      modelProviders: createApiFixture({}),
      traces: createApiFixture({}),
      oneTimeReveals: createApiFixture({}),
      apiKeys: createApiFixture({}),
      licensing: createApiFixture({}),
    },
    repositories,
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
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
  });
}
