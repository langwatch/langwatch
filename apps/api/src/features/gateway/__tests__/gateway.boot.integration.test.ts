/**
 * @vitest-environment node
 *
 * The gateway installed the way the API process installs it: the module boots
 * at `role: "api"`, and what comes back is the module's own application, so a
 * door reaching `ctx.app.gateway` and a door reaching the mounted namespaces
 * hold the same instance.
 *
 * Backed by an in-memory stand-in for the two tables the assertions touch,
 * because a boot proves wiring, not persistence: the repositories' own
 * contract tests are where a backend is proven.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { AuthzService } from "@langwatch/authz-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { MonitorApi } from "@langwatch/monitor-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import { installApiGateway } from "../gateway.composition.ts";
import type { ApiTrpcInfrastructure } from "../../../platform/infrastructure/api-trpc.infrastructure.ts";

const ORGANIZATION_ID = "organization_boot";

/** The two tables this boot reads, and nothing else. */
function memoryDatabase() {
  return {
    gatewayCacheRule: { findMany: vi.fn(async () => []) },
    gatewayGuardrail: { findMany: vi.fn(async () => []) },
    organization: {
      findUnique: vi.fn(async () => ({ id: ORGANIZATION_ID })),
    },
  } as unknown as PrismaClient;
}

function installOver(database: PrismaClient) {
  return installApiGateway({
    infrastructure: {
      prisma: database,
      authz: {} as AuthzService,
    } satisfies Pick<ApiTrpcInfrastructure, "prisma" | "authz">,
    peers: {
      projects: {} as ProjectApi,
      evaluators: createApiFixture<EvaluatorApi>(),
      monitors: createApiFixture<MonitorApi>(),
    },
    // No ClickHouse: the spend source is off by name rather than answering a
    // zero nobody can tell from a key that genuinely spent nothing.
    clickhouse: null,
    virtualKeyPepper: "0".repeat(64),
  });
}

describe("installing the gateway on the API process", () => {
  describe("when the process opened its database and named its peers", () => {
    it("boots the module and answers from its application", async () => {
      const database = memoryDatabase();

      const gateway = await installOver(database);

      await expect(gateway.app.listCacheRules(ORGANIZATION_ID)).resolves.toEqual([]);
      expect(gateway.composition).toBeDefined();
    });

    it("refuses an organization the deployment does not hold", async () => {
      const database = memoryDatabase();
      // @ts-expect-error the double narrows to PrismaClient for the installer
      database.organization.findUnique = vi.fn(async () => null);

      const gateway = await installOver(database);

      await expect(gateway.app.assertOrganizationExists(ORGANIZATION_ID)).rejects.toThrow();
    });
  });

  describe("when the process opened none of it", () => {
    it("still answers every gateway operation, by refusing each one by name", async () => {
      const gateway = await installApiGateway({
        infrastructure: undefined,
        peers: undefined,
        clickhouse: null,
        virtualKeyPepper: undefined,
      });

      expect(gateway.composition).toBeUndefined();
      expect(() => gateway.app.listCacheRules(ORGANIZATION_ID)).toThrow(/This deployment has no/);
    });
  });
});
