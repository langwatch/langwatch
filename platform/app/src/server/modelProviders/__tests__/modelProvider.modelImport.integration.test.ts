/**
 * @vitest-environment node
 *
 * Real-Postgres coverage for importing a custom provider's models on save,
 * against a local OpenAI-compatible endpoint serving /v1/models.
 *
 * Covers the saving scenarios of
 * specs/model-providers/custom-provider-model-import.feature.
 */

import { vi } from "vitest";

// `ssrfProtection` reads both at module load, and the fixture endpoint is on
// loopback, so they are set before any import evaluates it.
vi.hoisted(() => {
  process.env.IS_SAAS = "false";
  process.env.BLOCK_LOCAL_HTTP_CALLS = "false";
});

import http from "http";
import { nanoid } from "nanoid";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { seedRoleBinding } from "~/test-utils/authz-seeds";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { cleanupTestRows } from "../../../test-utils/cleanupTestRows";
import { MASKED_KEY_PLACEHOLDER } from "../../../utils/constants";
import { prisma } from "../../db";
import type { CustomModelEntry } from "../customModel.schema";
import {
  assertTestConnectionWithinBudget,
  ModelProviderService,
} from "../modelProvider.service";

wireDefaultTestApp();

const hasDatabase = !!process.env.DATABASE_URL;
const hasCredentialsSecret = !!process.env.CREDENTIALS_SECRET;

type EndpointState = {
  status: number;
  body: string;
  requests: { url: string; authorization?: string }[];
};

describe.skipIf(!hasDatabase || !hasCredentialsSecret)(
  "ModelProviderService model import on save (real DB)",
  () => {
    const ns = `mp-import-${nanoid(8)}`;
    const endpoint: EndpointState = { status: 200, body: "", requests: [] };
    let server: http.Server;
    let baseUrl: string;

    let organizationId: string;
    let teamId: string;
    let projectId: string;
    let orgAdminUserId: string;

    function listing(ids: string[]) {
      endpoint.status = 200;
      endpoint.body = JSON.stringify({
        object: "list",
        data: ids.map((id) => ({ id, object: "model" })),
      });
    }

    beforeAll(async () => {
      server = http.createServer((req, res) => {
        endpoint.requests.push({
          url: req.url ?? "",
          authorization: req.headers.authorization,
        });
        res.writeHead(endpoint.status, { "Content-Type": "application/json" });
        res.end(endpoint.body);
      });
      await new Promise<void>((resolve) =>
        server.listen(0, "127.0.0.1", resolve),
      );
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;

      const organization = await prisma.organization.create({
        data: { name: `Import Org ${ns}`, slug: `--test-${ns}` },
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
      await seedRoleBinding(prisma, {
        organizationId,
        userId: orgAdmin.id,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      });
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await cleanupTestRows(prisma, [
        [
          "modelProvider",
          { scopes: { some: { scopeType: "PROJECT", scopeId: projectId } } },
        ],
        ["grant", { organizationId }],
        ["roleBinding", { organizationId }],
        ["organizationUser", { organizationId }],
        ["user", { id: orgAdminUserId }],
        ["project", { id: projectId }],
        ["team", { id: teamId }],
        ["organization", { id: organizationId }],
      ]);
    });

    beforeEach(() => {
      endpoint.requests = [];
      listing([]);
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

    async function save({
      id,
      customModels,
      endpointUrl = baseUrl,
    }: {
      id?: string;
      customModels?: CustomModelEntry[];
      endpointUrl?: string;
    }) {
      return await service().updateModelProvider(
        {
          id,
          projectId,
          provider: "custom",
          name: "My Endpoint",
          enabled: true,
          customKeys: {
            CUSTOM_API_KEY: id ? MASKED_KEY_PLACEHOLDER : "sk-local-test",
            CUSTOM_BASE_URL: endpointUrl,
          },
          customModels,
          scopes: [{ scopeType: "PROJECT", scopeId: projectId }],
        },
        ctx(),
      );
    }

    async function storedChatIds(id: string): Promise<string[]> {
      const row = await prisma.modelProvider.findUniqueOrThrow({
        where: { id },
      });
      return ((row.customModels ?? []) as CustomModelEntry[]).map(
        (m) => m.modelId,
      );
    }

    async function storedChat(id: string): Promise<CustomModelEntry[]> {
      const row = await prisma.modelProvider.findUniqueOrThrow({
        where: { id },
      });
      return (row.customModels ?? []) as CustomModelEntry[];
    }

    describe("given an endpoint listing two models", () => {
      describe("when a new custom provider is saved", () => {
        /** @scenario Saving a new custom provider imports its models */
        it("stores both models and reports them imported", async () => {
          listing(["model-a", "model-b"]);

          const saved = await save({});

          expect(saved.modelImport).toEqual({
            status: "imported",
            added: 2,
            total: 2,
          });
          expect(await storedChatIds(saved.id)).toEqual(["model-a", "model-b"]);
          expect(endpoint.requests[0]).toEqual({
            url: "/v1/models",
            authorization: "Bearer sk-local-test",
          });
        });
      });
    });

    describe("given a saved provider with an imported model list", () => {
      describe("when the user adds a model by hand and saves again", () => {
        /** @scenario A manual entry survives the import */
        it("keeps the manual entry next to the imported ones", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const manual: CustomModelEntry = {
            modelId: "manual-model",
            displayName: "Manual",
            mode: "chat",
            maxTokens: 4096,
          };

          const saved = await save({
            id: created.id,
            customModels: [...(await storedChat(created.id)), manual],
          });

          expect(saved.modelImport).toEqual({
            status: "imported",
            added: 0,
            total: 2,
          });
          const stored = await storedChat(created.id);
          expect(stored.map((m) => m.modelId)).toEqual([
            "model-a",
            "model-b",
            "manual-model",
          ]);
          expect(stored.find((m) => m.modelId === "manual-model")).toEqual(
            manual,
          );
          // The masked key was resolved to the stored one for the probe.
          expect(endpoint.requests.at(-1)?.authorization).toBe(
            "Bearer sk-local-test",
          );
        });
      });

      describe("when the endpoint starts listing another model", () => {
        /** @scenario Saving again imports models the endpoint added */
        it("adds the new model on the next save", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          listing(["model-a", "model-b", "model-c"]);

          const saved = await save({
            id: created.id,
            customModels: await storedChat(created.id),
          });

          expect(saved.modelImport).toEqual({
            status: "imported",
            added: 1,
            total: 3,
          });
          expect(await storedChatIds(created.id)).toEqual([
            "model-a",
            "model-b",
            "model-c",
          ]);
        });
      });

      describe("when the user removed an imported model", () => {
        /** @scenario Saving again does not bring back a model I removed */
        it("does not import it again while the endpoint still lists it", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const withoutA = (await storedChat(created.id)).filter(
            (m) => m.modelId !== "model-a",
          );

          await save({ id: created.id, customModels: withoutA });
          const again = await save({
            id: created.id,
            customModels: await storedChat(created.id),
          });

          expect(again.modelImport).toEqual({
            status: "imported",
            added: 0,
            total: 2,
          });
          expect(await storedChatIds(created.id)).toEqual(["model-b"]);
        });
      });
    });

    describe("given a saved provider whose imported model was removed", () => {
      describe("when it is saved pointed at another endpoint", () => {
        /** @scenario Pointing the provider at another endpoint starts a fresh listing */
        it("imports the removed model from the new endpoint", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const withoutA = (await storedChat(created.id)).filter(
            (m) => m.modelId !== "model-a",
          );
          await save({ id: created.id, customModels: withoutA });

          // The same server under another host name is another endpoint.
          const otherEndpoint = baseUrl.replace("127.0.0.1", "localhost");
          const saved = await save({
            id: created.id,
            customModels: await storedChat(created.id),
            endpointUrl: otherEndpoint,
          });

          expect(saved.modelImport).toEqual({
            status: "imported",
            added: 1,
            total: 2,
          });
          expect(await storedChatIds(created.id)).toEqual([
            "model-b",
            "model-a",
          ]);
        });
      });
    });

    describe("given a saved provider moved to an endpoint that fails to list", () => {
      describe("when the new endpoint lists models on a later save", () => {
        /** @scenario Pointing the provider at another endpoint starts a fresh listing */
        it("imports the removed model once the new endpoint answers", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const withoutA = (await storedChat(created.id)).filter(
            (m) => m.modelId !== "model-a",
          );
          await save({ id: created.id, customModels: withoutA });

          const otherEndpoint = baseUrl.replace("127.0.0.1", "localhost");
          endpoint.status = 500;
          endpoint.body = '{"error":"boom"}';
          const moved = await save({
            id: created.id,
            customModels: await storedChat(created.id),
            endpointUrl: otherEndpoint,
          });
          expect(moved.modelImport).toEqual({ status: "failed" });

          listing(["model-a", "model-b"]);
          const saved = await save({
            id: created.id,
            customModels: await storedChat(created.id),
            endpointUrl: otherEndpoint,
          });

          expect(saved.modelImport).toEqual({
            status: "imported",
            added: 1,
            total: 2,
          });
          expect(await storedChatIds(created.id)).toEqual([
            "model-b",
            "model-a",
          ]);
        });
      });
    });

    describe("given an endpoint that fails to list", () => {
      /** @scenario An endpoint that fails to list does not block the save */
      it.each([
        { label: "answers 500", status: 500, body: '{"error":"boom"}' },
        { label: "answers non-JSON", status: 200, body: "<html>hi</html>" },
      ])("saves the models sent when it $label", async ({ status, body }) => {
        endpoint.status = status;
        endpoint.body = body;
        const manual: CustomModelEntry = {
          modelId: "manual-model",
          displayName: "manual-model",
          mode: "chat",
        };

        const saved = await save({ customModels: [manual] });

        expect(saved.modelImport).toEqual({ status: "failed" });
        expect(await storedChat(saved.id)).toEqual([manual]);
        const row = await prisma.modelProvider.findUniqueOrThrow({
          where: { id: saved.id },
        });
        expect(row.lastListedModelIds).toBeNull();
      });
    });

    // Last in the file: it spends the organization's whole budget.
    describe("given the organization used up its connection check budget", () => {
      /** @scenario An exhausted listing budget skips the import and keeps the save */
      it("saves the models sent and reports the import skipped without calling the endpoint", async () => {
        listing(["model-a"]);
        await expect(async () => {
          for (let i = 0; i < 100; i++) {
            await assertTestConnectionWithinBudget(organizationId);
          }
        }).rejects.toThrow();
        const manual: CustomModelEntry = {
          modelId: "manual-model",
          displayName: "manual-model",
          mode: "chat",
        };

        const saved = await save({ customModels: [manual] });

        expect(saved.modelImport).toEqual({ status: "skipped" });
        expect(await storedChat(saved.id)).toEqual([manual]);
        expect(endpoint.requests).toEqual([]);
      });
    });
  },
);
