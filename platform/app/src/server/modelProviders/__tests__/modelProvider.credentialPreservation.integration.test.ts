/**
 * @vitest-environment node
 *
 * Real-Postgres coverage for the credential a customer never retyped.
 *
 * The drawer shows a stored API key masked, so every save of an unrelated
 * field carries that placeholder back, and the service swaps it for the
 * credential already on file. A write that leaves the key out entirely gets
 * the same protection, since a masked value is one nobody can retype. Both
 * rules are asserted here, against the row the service actually wrote: the
 * credential a customer never touched has gone missing twice, each time
 * leaving a provider that had stopped working with nothing to explain why.
 *
 * Covers @integration scenarios from
 * specs/model-providers/provider-configuration.feature.
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";

import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { prisma } from "../../db";
import { ModelProviderRepository } from "../modelProvider.repository";
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
      await cleanupTestRows(prisma, [
        [
          "modelProvider",
          { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
        ],
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["user", { id: orgAdminUserId }],
        ["project", { id: projectId }],
        ["team", { id: teamId }],
        ["organization", { id: organizationId }],
      ]);
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

    // A payload that names none of the provider's credential fields cannot be
    // a credential edit, and applying it would drop every stored one. Azure's
    // schema is `.passthrough()` with everything optional, so it accepted such
    // a payload without a word and the row came back holding only a header.
    describe("given a payload that would drop every stored credential", () => {
      // Reads the row by id rather than through the collapsed per-provider
      // record `storedKeysOf` uses: these cases create several azure rows in
      // one project, and only one of them wins that collapse.
      async function keysById(id: string) {
        const row = await new ModelProviderRepository(
          prisma,
        ).findByIdWithDecryptedKeys(id);
        return row?.customKeys;
      }

      async function createAzureProvider() {
        return await service().updateModelProvider(
          {
            projectId,
            provider: "azure",
            enabled: true,
            customKeys: {
              AZURE_OPENAI_API_KEY: STORED_KEY,
              AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
            },
            scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          },
          ctx(),
        );
      }

      describe("when the payload carries only an extra header", () => {
        /** @scenario A header-only payload is refused instead of dropping credentials */
        it("is refused and the stored credentials survive", async () => {
          const created = await createAzureProvider();

          await expect(
            service().updateModelProvider(
              {
                projectId,
                id: created.id,
                provider: "azure",
                enabled: true,
                customKeys: { "api-key": "header-secret" },
                scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
              },
              ctx(),
            ),
          ).rejects.toThrow(/would delete the credentials/i);

          expect(await keysById(created.id)).toEqual({
            AZURE_OPENAI_API_KEY: STORED_KEY,
            AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
          });
        });
      });

      describe("when the payload is an empty object", () => {
        it("is refused rather than emptying the credential bag", async () => {
          const created = await createAzureProvider();

          await expect(
            service().updateModelProvider(
              {
                projectId,
                id: created.id,
                provider: "azure",
                enabled: true,
                customKeys: {},
                scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
              },
              ctx(),
            ),
          ).rejects.toThrow(/would delete the credentials/i);

          expect(await keysById(created.id)).toEqual({
            AZURE_OPENAI_API_KEY: STORED_KEY,
            AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
          });
        });
      });

      describe("when the payload names a credential field", () => {
        it("still goes through, and an unrelated key rides along", async () => {
          const created = await createAzureProvider();

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: {
                AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
                AZURE_OPENAI_ENDPOINT: "https://acme2.openai.azure.com",
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await keysById(created.id)).toEqual({
            AZURE_OPENAI_API_KEY: STORED_KEY,
            AZURE_OPENAI_ENDPOINT: "https://acme2.openai.azure.com",
          });
        });
      });

      describe("when the customer clears every credential on purpose", () => {
        it("still clears them, because the fields are sent empty rather than left out", async () => {
          const created = await createAzureProvider();

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: {
                AZURE_OPENAI_API_KEY: "",
                AZURE_OPENAI_ENDPOINT: "",
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await keysById(created.id)).toEqual({
            AZURE_OPENAI_API_KEY: "",
            AZURE_OPENAI_ENDPOINT: "",
          });
        });
      });

      describe("when the row has no credentials stored yet", () => {
        it("accepts the payload, since there is nothing to lose", async () => {
          const created = await service().updateModelProvider(
            {
              projectId,
              provider: "azure",
              enabled: true,
              customKeys: { AZURE_OPENAI_API_KEY: "" },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: { "api-key": "header-secret" },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await keysById(created.id)).toEqual({
            "api-key": "header-secret",
          });
        });
      });

      // A write that names some credentials passes the guard above, and then
      // the merge decides what happens to the ones it did not name. A secret
      // is masked on read, so nobody can resend one they did not type: leaving
      // it out is not a request to delete it. The visible fields are a
      // different matter, and the API gateway option depends on that.
      describe("when the payload names only some of the stored credentials", () => {
        /** @scenario A save that names one credential keeps the ones it leaves out */
        it("keeps the API key it never mentioned and updates the endpoint", async () => {
          const created = await createAzureProvider();

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: {
                AZURE_OPENAI_ENDPOINT: "https://acme3.openai.azure.com",
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await keysById(created.id)).toEqual({
            AZURE_OPENAI_API_KEY: STORED_KEY,
            AZURE_OPENAI_ENDPOINT: "https://acme3.openai.azure.com",
          });
        });

        // The REST upsert is the entry a script uses, and a script sends the
        // one field it means to change. It reaches the same merge through a
        // different door, so it is worth its own case.
        /** @scenario A save that names one credential keeps the ones it leaves out */
        it("keeps it through the REST upsert entry as well", async () => {
          const created = await service().updateModelProvider(
            {
              projectId,
              provider: "bedrock",
              enabled: true,
              customKeys: {
                AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
                AWS_SECRET_ACCESS_KEY: STORED_KEY,
                AWS_REGION_NAME: "us-east-1",
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          await service().upsertByProviderKey({
            projectId,
            provider: "bedrock",
            enabled: true,
            customKeys: { AWS_REGION_NAME: "eu-west-1" },
          });

          expect(await keysById(created.id)).toEqual({
            AWS_ACCESS_KEY_ID: "AKIAEXAMPLE",
            AWS_SECRET_ACCESS_KEY: STORED_KEY,
            AWS_REGION_NAME: "eu-west-1",
          });
        });

        /** @scenario Switching Azure to its API gateway keeps the key and drops the direct endpoint */
        it("drops the direct endpoint when the gateway fields take over, and keeps the key", async () => {
          const created = await createAzureProvider();

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: {
                AZURE_API_GATEWAY_BASE_URL: "https://apim.acme.com",
                AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          expect(await keysById(created.id)).toEqual({
            AZURE_API_GATEWAY_BASE_URL: "https://apim.acme.com",
            AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
            AZURE_OPENAI_API_KEY: STORED_KEY,
          });
        });
      });

      // The guard reads the provider's own schema rather than a list of
      // provider names, so it has to hold for the other two providers whose
      // drawer offers extra headers.
      //
      // Which layer says no depends on how strict the provider's schema is,
      // and both answers are right. `custom` accepts the payload and strips
      // the unknown key, so the guard is what catches it. `azure_safety`
      // demands a URL and a non-empty key, so validation rejects it one layer
      // earlier. That difference is the point: the guard exists precisely
      // because a loose schema, which is what Azure has, never objects.
      describe("when the same shape reaches a provider other than azure", () => {
        it.each([
          {
            provider: "custom",
            stored: {
              CUSTOM_API_KEY: "custom-secret",
              CUSTOM_BASE_URL: "https://proxy.acme.internal/v1",
            },
            rejectedWith: /would delete the credentials/i,
          },
          {
            provider: "azure_safety",
            stored: {
              AZURE_CONTENT_SAFETY_ENDPOINT: "https://safety.acme.internal",
              AZURE_CONTENT_SAFETY_KEY: "safety-secret",
            },
            rejectedWith: /invalid api key configuration/i,
          },
        ])("refuses it for $provider and keeps the stored credentials", async ({
          provider,
          stored,
          rejectedWith,
        }) => {
          const created = await service().updateModelProvider(
            {
              projectId,
              provider,
              enabled: true,
              customKeys: stored,
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          await expect(
            service().updateModelProvider(
              {
                projectId,
                id: created.id,
                provider,
                enabled: true,
                customKeys: { "x-tenant": "acme" },
                scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
              },
              ctx(),
            ),
          ).rejects.toThrow(rejectedWith);

          expect(await keysById(created.id)).toEqual(stored);
        });
      });
    });

    // A row whose stored bag will not decrypt reads back as null, exactly like
    // a row that never had one, so every guard above waved such a save through
    // and replaced ciphertext a restored CREDENTIALS_SECRET would have brought
    // back.
    describe("given a provider whose stored credentials can no longer be used", () => {
      // Azure again, because its schema accepts a payload that names none of
      // its credential fields. That is what lets the save reach the guard
      // instead of being turned back by key validation first.
      async function createAzureRow() {
        return await service().updateModelProvider(
          {
            projectId,
            provider: "azure",
            enabled: true,
            customKeys: {
              AZURE_OPENAI_API_KEY: STORED_KEY,
              AZURE_OPENAI_ENDPOINT: "https://acme.openai.azure.com",
            },
            scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
          },
          ctx(),
        );
      }

      const CIPHERTEXT = "not-a-value-this-secret-can-decrypt";

      async function makeUnusable(id: string) {
        await prisma.modelProvider.update({
          where: { id },
          data: { customKeys: CIPHERTEXT },
        });
      }

      async function rawKeysOf(id: string) {
        const row = await prisma.modelProvider.findUnique({
          where: { id },
          select: { customKeys: true },
        });
        return row?.customKeys;
      }

      async function refusal(id: string, customKeys: Record<string, unknown>) {
        try {
          await service().updateModelProvider(
            {
              projectId,
              id,
              provider: "azure",
              enabled: true,
              customKeys,
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );
        } catch (error) {
          return error as { code?: string };
        }
        return undefined;
      }

      describe.each([
        {
          name: "names no credential field",
          customKeys: {},
        },
        {
          name: "sends every credential field empty",
          customKeys: { AZURE_OPENAI_API_KEY: "", AZURE_OPENAI_ENDPOINT: "" },
        },
        {
          // What the drawer actually sends. It renders the masked placeholder
          // for the secret fields of an enabled row it found no credentials
          // on, so the ordinary save names every field and carries none.
          name: "sends the masked placeholder back",
          customKeys: {
            AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            AZURE_OPENAI_ENDPOINT: "",
          },
        },
      ])("when a save $name", ({ customKeys }) => {
        /** @scenario A provider with unusable credentials refuses a save that brings no replacement */
        it("is refused and the stored value survives", async () => {
          const created = await createAzureRow();
          await makeUnusable(created.id);

          const error = await refusal(created.id, customKeys);

          expect(error?.code).toBe("model_provider_credentials_unreadable");
          expect(await rawKeysOf(created.id)).toBe(CIPHERTEXT);
        });
      });

      describe("when the payload carries a new credential", () => {
        it("goes through, because that is the way back", async () => {
          const created = await createAzureRow();
          await makeUnusable(created.id);

          await service().updateModelProvider(
            {
              projectId,
              id: created.id,
              provider: "azure",
              enabled: true,
              customKeys: {
                AZURE_OPENAI_API_KEY: "sk-fresh",
                AZURE_OPENAI_ENDPOINT: "https://acme3.openai.azure.com",
              },
              scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
            },
            ctx(),
          );

          const row = await new ModelProviderRepository(
            prisma,
          ).findByIdWithDecryptedKeys(created.id);
          expect(row?.customKeys).toEqual({
            AZURE_OPENAI_API_KEY: "sk-fresh",
            AZURE_OPENAI_ENDPOINT: "https://acme3.openai.azure.com",
          });
        });
      });
    });
  },
);
