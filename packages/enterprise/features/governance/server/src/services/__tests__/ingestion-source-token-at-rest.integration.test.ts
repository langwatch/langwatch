/**
 * @vitest-environment node
 *
 * The credentials a pull-mode Genie source carries, as they actually land in
 * Postgres.
 *
 * This drives the REAL save path — `IngestionSourceService.createSource`
 * against the real `PrismaIngestionSourceRepository` — on purpose. Encrypting
 * the config in the test itself and writing the row directly would pass
 * whether or not `IngestionCredentialsService` still encrypts anything, since
 * the only encryption exercised would be the test's own. Only the crypto
 * boundary (`GovernanceEncryptionPort`) and the non-persistence collaborators
 * (projects, entitlements, secrets, destinations, diagnostics) are
 * substituted — none of them are what this test is protecting.
 *
 * The assertion that bites: it is on the SERIALISED row read back through
 * Prisma, not on the `credentials` key alone. A secret that leaked into some
 * other key would still be caught.
 */
import { Buffer } from "node:buffer";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { InternalProject, InternalProjectQuery } from "@langwatch/project-contract";

import { GovernanceDiagnosticsPort } from "../../ports/governance-diagnostics.port";
import { GovernanceEncryptionPort } from "../../ports/governance-encryption.port";
import {
  IngestionSourceEntitlementsPort,
  IngestionSourceLifecyclePort,
} from "../../ports/ingestion-source.port";
import { TestProjectService } from "../../ports/__tests__/support/test-project-service";
import { PrismaIngestionSourceRepository } from "../../repositories/prisma/prisma.ingestion-source.repository";
import { IngestionCredentialsService } from "../ingestion-credentials.service";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../ingestion-source-secret.service";
import { IngestionSourceService } from "../ingestion-source.service";
import { PullDestinationService } from "../pull-destination.service";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.LANGWATCH_TEST_DATABASE_URL ?? process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

// A real, reversible cipher (AES-256-GCM) — not an identity or base64 fake —
// so the stored ciphertext actually looks nothing like the plaintext.
class AesEncryption extends GovernanceEncryptionPort {
  private readonly key = randomBytes(32);

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
  }

  decrypt(ciphertext: string): string {
    const raw = Buffer.from(ciphertext, "base64url");
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString("utf8");
  }
}

class NoopEntitlements extends IngestionSourceEntitlementsPort {
  async hasEnterprisePlan(): Promise<boolean> {
    return true;
  }
}
class NoopLifecycle extends IngestionSourceLifecyclePort {
  async sync(): Promise<void> {}
}
class NoopDiagnostics extends GovernanceDiagnosticsPort {
  warn(): void {}
}

describe.skipIf(!databaseUrl)("IngestionSourceService token-at-rest", () => {
  const ns = `tok-rest-${nanoid(8)}`;
  let organizationId: string;
  let actorUserId: string;

  const service = () =>
    IngestionSourceService.create({
      repository: PrismaIngestionSourceRepository.create(prisma),
      projects: new (class extends TestProjectService {
        ensureInternal = async (_input: InternalProjectQuery): Promise<InternalProject> => ({
          id: `gov-project-${ns}`,
          name: "Governance (internal)",
          slug: `governance-${ns}`,
          teamId: `team-${ns}`,
          kind: "internal_governance",
          archivedAtMs: null,
          traceSharingEnabled: false,
        });
      })(),
      entitlements: new NoopEntitlements(),
      lifecycle: new NoopLifecycle(),
      credentials: IngestionCredentialsService.create(new AesEncryption()),
      secrets: IngestionSecretService.create(
        IngestionSecretConfiguration.create({ pepper: "pepper" }),
        { random: () => new Uint8Array(32).fill(7) },
      ),
      destinations: PullDestinationService.create(),
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
    await prisma.ingestionSource.deleteMany({ where: { organizationId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.deleteMany({ where: { slug: `--${ns}` } });
    await prisma.user.deleteMany({ where: { email: `${ns}-admin@example.com` } });
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
