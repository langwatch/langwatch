/**
 * @vitest-environment node
 *
 * Real-Postgres coverage for the credential a customer never retyped.
 *
 * The drawer shows a stored API key masked, so every save of an unrelated
 * field carries that placeholder back. The service is supposed to swap it
 * for the credential already on file. The sibling unit test asserts that
 * rule against a copy of the merge function, which is exactly why it stayed
 * green while a base-URL edit through the real path wrote the row without
 * any key at all: the credential the customer never touched was gone, and
 * the provider stopped working with no visible cause.
 *
 * Covers @integration scenarios from
 * specs/model-providers/provider-configuration.feature.
 */
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { prisma } from "../../db";
import { ModelProviderService } from "../modelProvider.service";

// Postgres and an encryption key are all this needs (the setup files
// provide a deterministic CREDENTIALS_SECRET), so it runs wherever the
// integration suite has a database — no ClickHouse gate like the sibling
// service suites, which that gate keeps permanently skipped.
const hasDatabase = !!process.env.DATABASE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

describe.skipIf(!hasDatabase || !hasCredentialsSecret)(
  "ModelProviderService credential preservation (real DB)",
  () => {
    const ns = `mp-cred-${nanoid(8)}`;
    const STORED_KEY = `sk-actual-${ns}`;
    const SELF_HOSTED = "https://llm.acme.internal/v1";

    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let orgAdminUserId: string;

    beforeAll(async () => {
      const organization = await prisma.organization.create({
        data: { name: `Cred Org ${ns}`, slug: `--test-${ns}` },
      });
      organizationId = organization.id;

      const team = await prisma.team.create({
        data: { name: `Team ${ns}`, slug: `--team-${ns}`, organizationId },
      });
      teamId = team.id;

      const project = await prisma.project.create({
        data: {
          name: `Project ${ns}`,
          slug: `--proj-${ns}`,
          teamId: team.id,
          language: "typescript",
          framework: "other",
          apiKey: `test-key-${ns}`,
        },
      });
      projectId = project.id;

      const orgAdmin = await prisma.user.create({
        data: { name: "Org Admin", email: `org-admin-${ns}@example.com` },
      });
      orgAdminUserId = orgAdmin.id;
      await prisma.organizationUser.create({
        data: {
          userId: orgAdmin.id,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
      });
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: orgAdmin.id,
          role: TeamUserRole.ADMIN,
          scopeType: RoleBindingScopeType.ORGANIZATION,
          scopeId: organizationId,
        },
      });
    });

    afterAll(async () => {
      // A half-finished beforeAll leaves these undefined, and Prisma drops
      // undefined predicates rather than matching nothing — so bail out
      // instead of deleting by an unfiltered `where`.
      if (!projectId || !organizationId) return;
      await prisma.modelProvider.deleteMany({
        where: {
          scopes: { some: { scopeType: "PROJECT", scopeId: projectId } },
        },
      });
      await prisma.roleBinding.deleteMany({ where: { organizationId } });
      await prisma.organizationUser.deleteMany({ where: { organizationId } });
      await prisma.user.deleteMany({ where: { id: orgAdminUserId } });
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.team.deleteMany({ where: { id: teamId } });
      await prisma.organization.deleteMany({ where: { id: organizationId } });
    });

    function service() {
      return ModelProviderService.create(prisma);
    }

    function ctx() {
      return {
        prisma,
        session: {
          user: {
            id: orgAdminUserId,
            email: `org-admin-${ns}@example.com`,
            name: "Org Admin",
          },
          expires: "2099-01-01T00:00:00.000Z",
        } as any,
      };
    }

    async function createKeyedProvider(provider: string) {
      return await service().updateModelProvider(
        {
          projectId,
          provider,
          enabled: true,
          customKeys: { [`${provider.toUpperCase()}_API_KEY`]: STORED_KEY },
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        },
        ctx(),
      );
    }

    async function storedKeysOf(id: string) {
      const rows = await service().getProjectModelProviders(projectId, true);
      const row = Object.values(rows).find(
        (r) => (r as { id?: string }).id === id,
      );
      return (row as { customKeys?: Record<string, unknown> } | undefined)
        ?.customKeys;
    }

    describe("given a provider whose API key is already on file", () => {
      describe("when a base URL is added and the key comes back masked", () => {
        /** @scenario Preserve original API key when saving with masked placeholder */
        it("keeps the stored key and stores the new base URL", async () => {
          const created = await createKeyedProvider("openai");

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "openai",
              enabled: true,
              customKeys: {
                OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
                OPENAI_BASE_URL: SELF_HOSTED,
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await storedKeysOf(created.id)).toEqual({
            OPENAI_API_KEY: STORED_KEY,
            OPENAI_BASE_URL: SELF_HOSTED,
          });
        });
      });

      describe("when the key field is cleared on purpose", () => {
        it("clears the stored key rather than restoring it", async () => {
          const created = await createKeyedProvider("anthropic");

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "anthropic",
              enabled: true,
              customKeys: {
                ANTHROPIC_API_KEY: "",
                ANTHROPIC_BASE_URL: SELF_HOSTED,
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await storedKeysOf(created.id)).toEqual({
            ANTHROPIC_API_KEY: "",
            ANTHROPIC_BASE_URL: SELF_HOSTED,
          });
        });
      });
    });
  },
);
