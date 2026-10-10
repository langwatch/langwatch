import type { EventingCommands } from "@langwatch/eventing";
import { ResourceScope } from "@langwatch/process";
import type { RateLimiter } from "@langwatch/process-stores";
import { ScopedSecrets } from "@langwatch/secrets";
/**
 * @vitest-environment node
 * @see specs/self-hosting/connected-services/managed-models-provider.feature
 * The production composition records the install's hosted provider slot as a licensing fact.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, describe, expect, it } from "vitest";

import { TEST_LICENSING_CONFIG, VALID_LICENSE_KEY } from "../../__tests__/testing.ts";
import type { LicensingCustomerPipeline } from "../../eventing/licensing-customer.pipeline.ts";
import { LiveLicensingRepositories } from "../../repositories/live/live.licensing.repositories.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "../../repositories/prisma/__tests__/support/licensing-database.fixture.ts";
import type { IssuedLicenseCipher } from "../../repositories/prisma/prisma.issued-license.repository.ts";
import { LicensingModule } from "../licensing.app.ts";

const RUN = `slot-${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!TEST_DATABASE_URL)("the install's hosted provider slot in production", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;

  afterAll(async () => {
    await prisma.organization.deleteMany({ where: { slug: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  describe("given a licensed organization and Connect switched off", () => {
    it("records the organization's slot cleared on every license sync", async () => {
      const organization = await prisma.organization.create({
        data: { name: "Acme", slug: `${RUN}-acme`, license: VALID_LICENSE_KEY },
      });
      const cleared: string[] = [];
      const app = await LicensingModule.create({
        dependencies: {},
        repositories: LiveLicensingRepositories.create({
          prisma,
          encryption: createApiFixture<IssuedLicenseCipher>(),
          rateLimiter: createApiFixture<RateLimiter>(),
        }),
        config: { ...TEST_LICENSING_CONFIG, isSaas: false },
        resources: new ResourceScope(),
        secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      });

      type Senders = EventingCommands<LicensingCustomerPipeline>;
      app.connectCustomerCommands(
        createApiFixture<Senders>({
          recordConnectUpstreamCleared: createApiFixture<Senders["recordConnectUpstreamCleared"]>({
            send: async ({ organizationId }) => {
              cleared.push(organizationId);
            },
          }),
        }),
      );

      await app.syncLicenses();

      expect(cleared).toContain(organization.id);
    });
  });
});
