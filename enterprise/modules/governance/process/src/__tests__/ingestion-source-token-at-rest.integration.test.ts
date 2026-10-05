/**
 * @vitest-environment node
 */
import { randomBytes } from "node:crypto";

import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { aesEncryption } from "@langwatch/process-stores";
import type {
  InternalProject,
  InternalProjectQuery,
  ProjectApi,
} from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createGovernanceTestConnection } from "../app/__tests__/governance-database.fixture.ts";
import { MemoryProviderAccountChannel } from "../channels/memory/memory.provider-account.channel.ts";
import { PrismaIngestionSourceRepository } from "../repositories/prisma/prisma.ingestion-source.repository.ts";
import type { GovernanceDiagnosticsSink } from "../services/governance-policy.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../services/ingestion-source-secret.service.ts";
import type {
  IngestionSourceEntitlements,
  IngestionSourceLifecycleChannel,
} from "../services/ingestion-source.service.ts";
import { IngestionSourceService } from "../services/ingestion-source.service.ts";
import { PullDestinationService } from "../services/pull-destination.service.ts";

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl ? createGovernanceTestConnection(databaseUrl) : null;
const prisma = connection?.client as PrismaClient;

// The process cipher itself (AES-256-GCM): the stored ciphertext looks nothing like the plaintext.
const cipher = aesEncryption(randomBytes(32));

class NoopEntitlements implements IngestionSourceEntitlements {
  async hasEnterprisePlan(): Promise<boolean> {
    return true;
  }
}
class NoopLifecycle implements IngestionSourceLifecycleChannel {
  async sync(): Promise<void> {}
}
class NoopDiagnostics implements GovernanceDiagnosticsSink {
  warn(): void {}
}

describe.skipIf(!databaseUrl)("IngestionSourceService token-at-rest", () => {
  const ns = `tok-rest-${nanoid(8)}`;
  let organizationId: string;
  let actorUserId: string;

  const service = () =>
    IngestionSourceService.create({
      repository: PrismaIngestionSourceRepository.create({ database: prisma, cipher }),
      projects: createApiFixture<ProjectApi>(
        {
          ensureInternal: async (_input: InternalProjectQuery): Promise<InternalProject> => ({
            id: `gov-project-${ns}`,
            name: "Governance (internal)",
            slug: `governance-${ns}`,
            teamId: `team-${ns}`,
            kind: "internal_governance",
            archivedAtMs: null,
            traceSharingEnabled: false,
          }),
        },
        "ProjectApi",
      ),
      entitlements: new NoopEntitlements(),
      lifecycle: new NoopLifecycle(),
      secrets: IngestionSecretService.create(
        IngestionSecretConfiguration.create({ pepper: "pepper" }),
        { random: () => new Uint8Array(32).fill(7) },
      ),
      destinations: PullDestinationService.create(),
      providerAccounts: MemoryProviderAccountChannel.create(),
      diagnostics: new NoopDiagnostics(),
    });

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Token At Rest Org ${ns}`, slug: `--${ns}` },
    });
    organizationId = organization.id;
    await prisma.team.create({
      data: {
        name: `Token At Rest Team ${ns}`,
        slug: `--${ns}-team`,
        organizationId,
      },
    });
    const admin = await prisma.user.create({
      data: { name: "Admin", email: `${ns}-admin@example.com` },
    });
    actorUserId = admin.id;
  }, 60_000);

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["ingestionSource", { organizationId }],
      ["team", { organizationId }],
      ["organization", { slug: `--${ns}` }],
      ["user", { email: `${ns}-admin@example.com` }],
    ]);
  });

  describe("given an admin saves a Genie source carrying a workspace token", () => {
    describe("when the source is saved through the service", () => {
      /** @scenario "The workspace token is never stored in plain text" */
      it("stores the token encrypted and unreadable from the source's configuration", async () => {
        const token = `dapi-${nanoid(24)}`;

        const { source } = await service().createSource({
          organizationId,
          sourceType: "databricks_genie",
          name: `genie-token-at-rest-${ns}`,
          pullConfig: {
            adapter: "databricks_genie",
            workspaceUrl: "https://adb-1234567890123456.7.azuredatabricks.net",
            spaceIds: [],
            schedule: "*/15 * * * *",
            credentials: { token },
          },
          pullSchedule: "*/15 * * * *",
          actorUserId,
        });

        const row = await prisma.ingestionSource.findUniqueOrThrow({
          where: { id: source.id },
        });
        const stored = row.parserConfig as Record<string, unknown>;

        expect(JSON.stringify(stored)).not.toContain(token);
        expect(typeof stored.credentials).toBe("string");
        expect(stored.credentials as string).toMatch(/^enc:v1:/);
      }, 60_000);
    });
  });

  describe("given an admin saves a Genie source carrying a client id and secret", () => {
    describe("when the source is saved through the service", () => {
      /** @scenario "The client secret is never stored in plain text" */
      it("stores the secret encrypted and unreadable from the source's configuration", async () => {
        const clientId = `sp-${nanoid(12)}`;
        const clientSecret = `dose${nanoid(28)}`;

        const { source } = await service().createSource({
          organizationId,
          sourceType: "databricks_genie",
          name: `genie-secret-at-rest-${ns}`,
          pullConfig: {
            adapter: "databricks_genie",
            workspaceUrl: "https://adb-1234567890123456.7.azuredatabricks.net",
            spaceIds: [],
            schedule: "*/15 * * * *",
            credentials: { clientId, clientSecret },
          },
          pullSchedule: "*/15 * * * *",
          actorUserId,
        });

        const row = await prisma.ingestionSource.findUniqueOrThrow({
          where: { id: source.id },
        });
        const stored = row.parserConfig as Record<string, unknown>;

        expect(JSON.stringify(stored)).not.toContain(clientSecret);
        expect(typeof stored.credentials).toBe("string");
        expect(stored.credentials as string).toMatch(/^enc:v1:/);
      }, 60_000);
    });
  });
});
