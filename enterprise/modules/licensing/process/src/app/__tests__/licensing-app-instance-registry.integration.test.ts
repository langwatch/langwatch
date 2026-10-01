import type { GatewayApi } from "@langwatch/gateway-contract";
import type { InstantEvalApi } from "@langwatch/instant-eval-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import type { Encryption, RateLimiter } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createTestLogger } from "@langwatch/test-harness";
/**
 * @vitest-environment node
 * @see enterprise/modules/licensing/specs/licensing.feature
 * The production composition reads the instance registry from Postgres, as main did on every
 * deployment.
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant } from "@langwatch/time";
import { afterAll, describe, expect, it } from "vitest";

import { TEST_LICENSING_CONFIG } from "../../__tests__/testing.ts";
import {
  createLicensingTestConnection,
  TEST_DATABASE_URL,
} from "../../repositories/prisma/__tests__/support/licensing-database.fixture.ts";
import { PrismaSelfHostedInstanceRepository } from "../../repositories/prisma/prisma.self-hosted-instance.repository.ts";
import { LicensingApp } from "../licensing.app.ts";

const RUN = `instlist-${crypto.randomUUID().slice(0, 8)}`;

describe.skipIf(!TEST_DATABASE_URL)("the self-hosted instance registry in production", () => {
  const connection = createLicensingTestConnection(TEST_DATABASE_URL ?? "");
  const prisma = connection.client;

  afterAll(async () => {
    await prisma.selfHostedInstance.deleteMany({ where: { instanceId: { startsWith: RUN } } });
    await prisma.organization.deleteMany({ where: { slug: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  describe("given an install that reported, attributed to an organization", () => {
    /** @scenario "A deployment composed from its stores lists installs with their customer's name" */
    it("lists the install with the name the organization feature answers", async () => {
      const organization = await prisma.organization.create({
        data: { name: "Acme", slug: `${RUN}-acme` },
      });
      await PrismaSelfHostedInstanceRepository.create(prisma).upsert({
        instanceId: `${RUN}-install`,
        lastSeenAt: nowInstant(),
        version: "3.17.0",
        installMethod: "helm",
        chartVersion: "1.3.0",
        hostname: null,
        environment: "production",
        installedAt: null,
        reportSchemaVersion: 2,
        organizationId: organization.id,
        issuedLicenseId: null,
        userEmailDomains: null,
        latestReport: { version: "3.17.0" },
        optionalMetricsReported: false,
        hostnameReported: false,
        lastUnknownFields: 0,
        raisedSignals: [],
      });
      const app = await LicensingApp.create({
        dependencies: {
          instantEval: createApiFixture<InstantEvalApi>(),
          projects: createApiFixture<ProjectApi>(),
          gateway: createApiFixture<GatewayApi>(),
          organizations: createApiFixture<OrganizationApi>({
            findProvisioningSummary: async (organizationId) =>
              organizationId === organization.id
                ? {
                    id: organization.id,
                    name: "Acme Corp",
                    slug: organization.slug,
                    createdAt: nowInstant(),
                  }
                : null,
          }),
        },
        members: {
          prisma,
          logger: createTestLogger().logger,
          encryption: createApiFixture<Encryption>(),
          rateLimiter: createApiFixture<RateLimiter>(),
          isSaas: true,
          serviceVersion: "test",
        },
        config: TEST_LICENSING_CONFIG,
        resources: new ResourceScope(),
        secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
      });

      const page = await app.listSelfHostedInstances({
        page: 0,
        pageSize: 25,
        search: `${RUN}-install`,
      });

      expect(page.instances).toMatchObject([
        {
          instanceId: `${RUN}-install`,
          organizationId: organization.id,
          organizationName: "Acme Corp",
        },
      ]);
    });
  });
});
