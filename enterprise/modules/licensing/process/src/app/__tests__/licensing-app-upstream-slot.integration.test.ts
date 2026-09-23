/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/managed-models-provider.feature
 * The production composition writes the install's hosted provider slot through the gateway peer.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { GatewayApi } from "@langwatch/gateway-contract";
import { ResourceScope } from "@langwatch/kernel";
import { ScopedSecrets } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
import { afterAll, describe, expect, it } from "vitest";

import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "../../repositories/prisma/__tests__/support/licensing-database.fixture.ts";
import { TEST_LICENSING_CONFIG, VALID_LICENSE_KEY } from "../../testing.ts";
import { LicensingApp } from "../licensing.app.ts";

const RUN = `slot-${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!TEST_DATABASE_URL)("the install's hosted provider slot in production", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  describe("given a licensed organization and Connect switched off", () => {
    it("clears the organization's slot through the gateway on every license sync", async () => {
      const organization = await prisma.organization.create({
        data: { name: "Acme", slug: `${RUN}-acme`, license: VALID_LICENSE_KEY },
      });
      const cleared: string[] = [];
      const app = await LicensingApp.create({
        dependencies: {
          gateway: createApiFixture<GatewayApi>({
            clearConnectUpstreamInternal: async ({ organizationId }) => {
              cleared.push(organizationId);
            },
          }),
        },
        members: {
          prisma,
          logger: createTestLogger().logger,
          isSaas: false,
          serviceVersion: "test",
        },
        config: TEST_LICENSING_CONFIG,
        resources: new ResourceScope(),
        secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      });

      await app.syncLicenses();

      expect(cleared).toContain(organization.id);
    });
  });
});
