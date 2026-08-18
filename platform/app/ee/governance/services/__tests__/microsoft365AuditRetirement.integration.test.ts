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

import { readFile } from "node:fs/promises";
import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { UNLIMITED_PLAN } from "@ee/licensing/constants";
import type { PlanInfo } from "@ee/licensing/planInfo";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";

const RETIRED_REASON = "[retired] Polled an Entra directory-change feed";

const createdOrgIds: string[] = [];
/**
 * Built from UNLIMITED_PLAN rather than FREE_PLAN, and with every tier-defining
 * field overridden. Spreading FREE_PLAN and setting only `type` leaves
 * `free: true` and `planSource: "free"` in place, so anything that branches on
 * those — rather than on `type` — takes the free path while the fixture claims
 * to be enterprise.
 */
const enterprisePlan: PlanInfo = {
  ...UNLIMITED_PLAN,
  type: "ENTERPRISE",
  name: "Enterprise",
  free: false,
  planSource: "license",
};

beforeAll(async () => {
  // createSource() reads getApp().planProvider to enforce the source cap, so
  // this file needs a composition root. createTestApp is the one to use:
  // initializeDefaultApp boots the trace-processing pipeline too, which
  // `require`s ~/server/db and cannot resolve that alias in this lane.
  // Enterprise, because m365 audit ingestion is an enterprise-tier surface
  // and the cap is not what these tests are about.
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => enterprisePlan,
    }),
  });
});

afterAll(async () => {
  await resetApp();
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

const MIGRATION_SQL_URL = new URL(
  "../../../../prisma/migrations/20260817120001_disable_copilot_studio_ingestion_sources/migration.sql",
  import.meta.url,
);

/**
 * Runs the shipped migration, read off disk rather than retyped here.
 *
 * These tests exist to prove that statement is safe to re-run against
 * production rows, so a hand-copied lookalike would prove it about the wrong
 * text — edit the .sql and the copy keeps passing. Reading the file means the
 * only way to make these tests agree with a broken migration is to break the
 * migration.
 *
 * The real migration is applied by `prisma migrate deploy`, which never goes
 * through the app's client and so never meets the tenancy guard. Running it
 * through `prisma` here does, so the opt-out is prepended at execute time
 * instead of living in the .sql: the guard is this lane's concern, not the
 * migration's. It is honest either way — retiring a source type is a
 * fleet-wide statement with no tenant to scope it to.
 */
async function runDisableMigration(): Promise<void> {
  const sql = await readFile(MIGRATION_SQL_URL, "utf8");
  await prisma.$executeRawUnsafe(
    `-- @tenancy: retires a source type across every tenant (schema migration)\n${sql}`,
  );
}

describe("microsoft_365_audit credential seam", () => {
  /** @scenario "Client secret submitted in the UI reaches the adapter decrypted" */
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
  /** @scenario "Existing copilot_studio sources are disabled with a stated reason" */
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

  /** @scenario "Migration is idempotent and does not clobber a deliberate re-enable" */
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
