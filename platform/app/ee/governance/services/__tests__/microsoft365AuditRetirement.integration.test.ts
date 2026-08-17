/**
 * @vitest-environment node
 *
 * The two halves of #7137 that genuinely cross into the database: the client
 * secret surviving the round trip from composer to worker, and the migration
 * that disables the retired `copilot_studio` sources.
 *
 * The credential test is the regression guard for #6785. The composer used to
 * submit a bare `{ adapter }` pullConfig and drop the credential fields into
 * `parserConfig` at top level, where `encryptParserConfigCredentials` never
 * looked — it only walks the `credentials` subtree. Once PR #6670 taught the
 * redactor to recognise those fields as secrets, they stopped being written
 * in plaintext and started being written nowhere at all.
 *
 * The migration tests assert the two properties that make it safe to re-run:
 * it disables what it should, and it does not overwrite an admin who has
 * since deliberately re-enabled a source.
 *
 * Spec: specs/ai-governance/puller-framework/microsoft-365-audit.feature
 */

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";

const RETIRED_REASON = "[retired] Polled an Entra directory-change feed";

const createdOrgIds: string[] = [];

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await prisma.ingestionSource.deleteMany({
      where: { organizationId: { in: createdOrgIds } },
    });
    await prisma.organization.deleteMany({
      where: { id: { in: createdOrgIds } },
    });
  }
});

async function makeOrg(): Promise<string> {
  const id = `org-m365-${nanoid(8)}`;
  await prisma.organization.create({
    data: { id, name: `ACME ${id}`, slug: id },
  });
  createdOrgIds.push(id);
  return id;
}

/**
 * The migration, expressed as the statement the .sql file runs. Kept in step
 * with prisma/migrations/20260817000002_disable_copilot_studio_ingestion_sources.
 */
async function runDisableMigration(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    UPDATE "IngestionSource"
       SET "status" = 'disabled',
           "description" = CASE
             WHEN "description" IS NULL OR "description" = ''
               THEN '${RETIRED_REASON} that never returned Copilot interactions. Re-create this source as microsoft_365_audit.'
               ELSE "description" || E'\\n${RETIRED_REASON} that never returned Copilot interactions. Re-create this source as microsoft_365_audit.'
           END
     WHERE "sourceType" = 'copilot_studio'
       AND "status" <> 'disabled'
       AND ("description" IS NULL OR "description" NOT LIKE '%${RETIRED_REASON}%');
  `);
}

describe("microsoft_365_audit credential seam", () => {
  /** @scenario Client secret submitted in the UI reaches the adapter decrypted */
  it("encrypts the client secret at rest and hands the real value back to the worker", async () => {
    const organizationId = await makeOrg();
    const service = IngestionSourceService.create(prisma);
    const clientSecret = `secret-${nanoid(12)}`;

    const { source } = await service.createSource({
      organizationId,
      sourceType: "microsoft_365_audit",
      name: `acme-m365-${nanoid(6)}`,
      actorUserId: "test-user",
      pullConfig: {
        adapter: "microsoft_365_audit",
        contentType: "Audit.General",
        tenantId: "acme-tenant-guid",
        credentials: {
          tenantId: "acme-tenant-guid",
          clientId: "acme-app-guid",
          clientSecret,
        },
      },
      parserConfig: {},
    });

    const stored = await prisma.ingestionSource.findUniqueOrThrow({
      where: { id: source.id },
    });
    const serialised = JSON.stringify(stored.parserConfig);

    // Stored encrypted, never in the clear. This is the whole of #6785: it
    // used to be one or the other, and latterly neither.
    expect(serialised).not.toContain(clientSecret);
    expect(serialised).toContain("enc:v1:");

    // And it round-trips: the puller has to present the real value to
    // Microsoft, so a hash would be useless here.
    const { decryptCredentials } = await import(
      "@ee/governance/services/activity-monitor/ingestionCredentials"
    );
    const config = stored.parserConfig as {
      credentials: Record<string, string>;
    };
    const decrypted = decryptCredentials(config.credentials);
    expect(decrypted.clientSecret).toBe(clientSecret);
  });
});

describe("copilot_studio disable migration", () => {
  /** @scenario Existing copilot_studio sources are disabled with a stated reason */
  it("disables the retired sources, states why, and leaves their config intact", async () => {
    const organizationId = await makeOrg();
    const parserConfig = {
      tenantId: "acme-tenant-guid",
      clientId: "acme-app-guid",
    };

    const created = await prisma.ingestionSource.create({
      data: {
        organizationId,
        sourceType: "copilot_studio",
        name: `acme-legacy-${nanoid(6)}`,
        description: "Set up by the platform team",
        ingestSecretHash: "hash",
        parserConfig,
        status: "awaiting_first_event",
      },
    });

    await runDisableMigration();

    const after = await prisma.ingestionSource.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(after.status).toBe("disabled");
    expect(after.description).toContain(RETIRED_REASON);
    // The operator's own description survives — the reason is appended.
    expect(after.description).toContain("Set up by the platform team");
    // Config untouched, so the tenant and client ids remain readable when the
    // operator sets the replacement up. Deliberately NOT repointed: the new
    // source needs a different permission and a secret these rows never had.
    expect(after.parserConfig).toEqual(parserConfig);
    expect(after.sourceType).toBe("copilot_studio");
  });

  /** @scenario Migration is idempotent and does not clobber a deliberate re-enable */
  it("leaves a re-enabled source as the admin set it and never double-stamps", async () => {
    const organizationId = await makeOrg();
    const created = await prisma.ingestionSource.create({
      data: {
        organizationId,
        sourceType: "copilot_studio",
        name: `acme-reenabled-${nanoid(6)}`,
        ingestSecretHash: "hash",
        parserConfig: {},
        status: "awaiting_first_event",
      },
    });

    await runDisableMigration();

    // An admin deliberately turns it back on.
    await prisma.ingestionSource.update({
      where: { id: created.id },
      data: { status: "active" },
    });

    // Running again must not undo that decision.
    await runDisableMigration();

    const after = await prisma.ingestionSource.findUniqueOrThrow({
      where: { id: created.id },
    });

    expect(after.status).toBe("active");
    // Nor stamp the reason a second time.
    const occurrences =
      (after.description ?? "").split(RETIRED_REASON).length - 1;
    expect(occurrences).toBe(1);
  });

  it("does not touch sources of any other type", async () => {
    const organizationId = await makeOrg();
    const other = await prisma.ingestionSource.create({
      data: {
        organizationId,
        sourceType: "otel_generic",
        name: `acme-otel-${nanoid(6)}`,
        ingestSecretHash: "hash",
        parserConfig: {},
        status: "awaiting_first_event",
      },
    });

    await runDisableMigration();

    const after = await prisma.ingestionSource.findUniqueOrThrow({
      where: { id: other.id },
    });
    expect(after.status).toBe("awaiting_first_event");
    expect(after.description).toBeNull();
  });
});
