// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The workspace token a pull-mode source carries, as it actually lands in
 * Postgres.
 *
 * This drives the REAL save path — `IngestionSourceService.createSource` — on
 * purpose, and that is the whole point of the file rather than an incidental
 * choice. The obvious version of this test encrypts the config itself and then
 * writes the row with `prisma.ingestionSource.create`; it passes whether or not
 * production still encrypts anything, because the only encryption it exercises
 * is its own. Deleting the `encryptParserConfigCredentials` call from
 * `createSource` was verified to leave that shape green.
 *
 * So nothing here encrypts. The test hands `createSource` a plaintext token,
 * reads the row back through Prisma, and asserts the plaintext is not in it.
 * Remove the encryption from the service and this fails.
 *
 * Also worth stating: the assertion is on the SERIALISED row, not on the
 * `credentials` key alone. A secret that leaked into some other key — the trap
 * the form's `isSecretFieldKey` guard exists for — would still be caught.
 */

import { IngestionSourceService } from "@ee/governance/services/activity-monitor/ingestionSource.service";
import { FREE_PLAN } from "@ee/licensing/constants";
import type { PlanInfo } from "@ee/licensing/planInfo";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import { PlanProviderService } from "~/server/app-layer/subscription/plan-provider";
import { prisma } from "~/server/db";
import { cleanupTestRows, requireAssigned } from "~/test-utils/cleanupTestRows";
import { decryptCredentials } from "../ingestionCredentials";

const ns = `tok-rest-${nanoid(8)}`;
// Enterprise so the source cap cannot reject the create for a reason that has
// nothing to do with what is under test.
const enterprisePlan: PlanInfo = { ...FREE_PLAN, type: "ENTERPRISE" };

let organizationId: string;
let actorUserId: string;

beforeAll(async () => {
  await resetApp();
  globalForApp.__langwatch_app = createTestApp({
    planProvider: PlanProviderService.create({
      getActivePlan: async () => enterprisePlan,
    }),
  });

  const organization = await prisma.organization.create({
    data: { name: `Token At Rest Org ${ns}`, slug: `--${ns}` },
  });
  organizationId = organization.id;

  // The governance slice provisions a hidden project on first source mint and
  // refuses to do so for an org with no team, so the org needs one before
  // `createSource` will run at all.
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
});

afterAll(async () => {
  // The governance slice provisions its own internal project on first source
  // mint, so the team's projects go before the team does. Anchored on the
  // organization so a broken setup cannot widen these deletes.
  const projectIds = (
    await prisma.project.findMany({
      where: {
        team: {
          organizationId: requireAssigned({
            value: organizationId,
            name: "organizationId",
          }),
        },
      },
      select: { id: true },
    })
  ).map((project) => project.id);
  await cleanupTestRows(prisma, [
    ["ingestionSource", { organizationId }],
    ["projectSecret", { projectId: { in: projectIds } }],
    ["project", { team: { organizationId } }],
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
      const service = IngestionSourceService.create(prisma);

      // The pullConfig the governance form produces for Genie. The secret
      // travels only inside `credentials`, never as a top-level key, and it
      // goes in as PLAINTEXT — encrypting it here would test nothing.
      const { source } = await service.createSource({
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

      // The assertion that bites: the secret is not recoverable by reading the
      // row, anywhere in it, at any depth.
      expect(JSON.stringify(stored)).not.toContain(token);

      expect(typeof stored.credentials).toBe("string");
      expect(stored.credentials as string).toMatch(/^enc:v1:/);

      // Encrypted is not the same as lost — the puller still resolves it.
      expect(decryptCredentials(stored.credentials)).toEqual({ token });
    }, 60_000);
  });
});

describe("given an admin saves a Genie source carrying a client id and secret", () => {
  describe("when the source is saved through the service", () => {
    /** @scenario "The client secret is never stored in plain text" */
    it("stores the secret encrypted and unreadable from the source's configuration", async () => {
      const clientId = `sp-${nanoid(12)}`;
      const clientSecret = `dose${nanoid(28)}`;
      const service = IngestionSourceService.create(prisma);

      // Same save path as the token above, with the service-principal shape
      // the governance form produces: both halves inside `credentials`, the
      // secret in plaintext — the service is the one that must encrypt it.
      const { source } = await service.createSource({
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

      // The whole serialised row, so a secret leaking into any other key is
      // caught, not just one that stayed under `credentials`.
      expect(JSON.stringify(stored)).not.toContain(clientSecret);

      expect(typeof stored.credentials).toBe("string");
      expect(stored.credentials as string).toMatch(/^enc:v1:/);

      // Encrypted is not the same as lost — the puller still signs in with it.
      expect(decryptCredentials(stored.credentials)).toEqual({
        clientId,
        clientSecret,
      });
    }, 60_000);
  });
});

describe("given an admin saves an OpenAI Admin source carrying an admin API key", () => {
  describe("when the source is saved through the service", () => {
    /** @scenario "The Admin API key is never stored in plain text" */
    it("stores the key encrypted and unreadable from the source's configuration", async () => {
      const token = `sk-admin-${nanoid(24)}`;
      const service = IngestionSourceService.create(prisma);

      // The pullConfig the governance composer produces for the OpenAI Admin
      // cost source, with the key in PLAINTEXT — the service is the one that
      // must encrypt it, so encrypting it here would test nothing.
      const { source } = await service.createSource({
        organizationId,
        sourceType: "openai_admin",
        name: `openai-admin-key-at-rest-${ns}`,
        pullConfig: {
          adapter: "openai_admin",
          report: "cost",
          startingAt: "2026-07-01T00:00:00.000Z",
          schedule: "0 * * * *",
          credentials: { token },
        },
        pullSchedule: "0 * * * *",
        actorUserId,
      });

      const row = await prisma.ingestionSource.findUniqueOrThrow({
        where: { id: source.id },
      });
      const stored = row.parserConfig as Record<string, unknown>;

      // The whole serialised row, so a key leaking into any other field is
      // caught, not just one that stayed under `credentials`.
      expect(JSON.stringify(stored)).not.toContain(token);

      expect(typeof stored.credentials).toBe("string");
      expect(stored.credentials as string).toMatch(/^enc:v1:/);

      // Encrypted is not the same as lost — the puller still authenticates.
      expect(decryptCredentials(stored.credentials)).toEqual({ token });
    }, 60_000);
  });
});
