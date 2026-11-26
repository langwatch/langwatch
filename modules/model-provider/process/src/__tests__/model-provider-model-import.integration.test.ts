/**
 * Real-Postgres coverage for importing a custom provider's models on save, against a local
 * OpenAI-compatible endpoint serving /v1/models through the real listing client and egress fence.
 * @vitest-environment node
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import http from "node:http";
import type { AddressInfo } from "node:net";

import {
  MASKED_KEY_PLACEHOLDER,
  ModelProviderTestRateLimitedError,
  type Model,
} from "@langwatch/model-provider-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { SsrfModelProviderEgressService } from "../features/credential-probe/services/ssrf-model-provider-egress.service.ts";
import { WindowedModelProviderConnectionRateLimiterService } from "../features/credential-probe/services/windowed-model-provider-connection-rate-limiter.service.ts";
import { HttpModelProviderModelListService } from "../features/served-models/services/http-model-provider-model-list.service.ts";
import { ModelProviderModelImportService } from "../features/served-models/services/model-provider-model-import.service.ts";
import { MemoryModelProviderRateLimitRepository } from "../repositories/memory/memory.model-provider-rate-limit.repository.ts";
import { ModelProviderRateLimitRepository } from "../repositories/model-provider-rate-limit.repository.ts";
import { PrismaModelProviderRepository } from "../repositories/prisma/prisma.model-provider.repository.ts";
import { ModelProviderAuthorizationService } from "../services/model-provider-authorization.service.ts";
import { ModelProviderCommandService } from "../services/model-provider-command.service.ts";
import { ModelProviderKeysService } from "../services/model-provider-keys.service.ts";
import { ModelProviderScopeService } from "../services/model-provider-scope.service.ts";
import { ModelProviderWriteAuthorizationService } from "../services/model-provider-write-authorization.service.ts";
import {
  DB_URL,
  IdentityModelProviderCredentialCodec,
  TestModelProviderCatalog,
  cleanupTenancyFixture,
  createPrismaProjects,
  createTenancyFixture,
  createTestAuthzApi,
  createTestPrismaClient,
  idService,
  noopOnboardingDefaults,
  testNamespace,
  type TenancyFixture,
} from "./support/model-provider-integration.support.ts";

/** A rate-limit store that cannot be reached, as a Redis outage would leave it. */
class UnreachableRateLimitRepository extends ModelProviderRateLimitRepository {
  consume(): Promise<{ allowed: boolean; resetAt: number }> {
    return Promise.reject(new Error("rate-limit store unreachable"));
  }
}

type EndpointState = {
  status: number;
  body: string;
  requests: { url: string; authorization?: string }[];
};

describe.skipIf(!DB_URL)(
  "saving a custom provider imports its listed models (real Postgres)",
  () => {
    const prisma: PrismaClient = createTestPrismaClient();
    const repository = PrismaModelProviderRepository.create(
      prisma,
      new IdentityModelProviderCredentialCodec(),
    );
    const scopes = ModelProviderScopeService.create({
      projects: createPrismaProjects(prisma),
      organizations: {
        getBillingProfile: async (input: { organizationId: string }) => ({
          id: input.organizationId,
        }),
      } as never,
    });
    const writeAuthorization = ModelProviderWriteAuthorizationService.create(
      ModelProviderAuthorizationService.create(
        createTestAuthzApi(async () => ({ permitted: true, organizationRole: null })),
      ),
    );
    const modelList = HttpModelProviderModelListService.create({
      egress: SsrfModelProviderEgressService.create({
        policy: { blockLocal: false, allowedHosts: [], verifyTls: true },
      }),
    });

    const ns = testNamespace("mp-import");
    const endpoint: EndpointState = { status: 200, body: "", requests: [] };
    let server: http.Server;
    let baseUrl: string;
    let fixture: TenancyFixture;
    let rateLimits: ModelProviderRateLimitRepository;

    function command(): ModelProviderCommandService {
      const connectionRateLimiter = WindowedModelProviderConnectionRateLimiterService.create({
        limiter: rateLimits,
      });
      return ModelProviderCommandService.create({
        repository,
        scopes,
        writeAuthorization,
        credentialPolicy: ModelProviderKeysService.create(),
        catalog: new TestModelProviderCatalog(),
        connectionRateLimiter,
        onboardingDefaults: noopOnboardingDefaults as never,
        ids: idService,
        defaults: {} as never,
        connectionPing: {} as never,
        modelImport: ModelProviderModelImportService.create({ modelList, connectionRateLimiter }),
      });
    }

    function listing(ids: string[]): void {
      endpoint.status = 200;
      endpoint.body = JSON.stringify({
        object: "list",
        data: ids.map((id) => ({ id, object: "model" })),
      });
    }

    function save({
      id,
      customModels,
      endpointUrl = baseUrl,
    }: {
      id?: string;
      customModels?: Model[];
      endpointUrl?: string;
    }) {
      return command().upsert({
        id,
        projectId: fixture.projectId,
        actorId: fixture.adminUserId,
        provider: "custom",
        name: "My Endpoint",
        enabled: true,
        customKeys: {
          CUSTOM_API_KEY: id ? MASKED_KEY_PLACEHOLDER : "sk-local-test",
          CUSTOM_BASE_URL: endpointUrl,
        },
        customModels,
        scopes: [{ scopeType: "PROJECT", scopeId: fixture.projectId }],
      });
    }

    async function storedChat(id: string): Promise<Model[]> {
      return (await repository.getById({ id, organizationId: fixture.organizationId }))
        .customModels;
    }

    const ids = (models: Model[]) => models.map((model) => model.id);
    const manual: Model = { id: "manual-model", label: "Manual", type: "chat", maxTokens: 4096 };

    beforeAll(async () => {
      server = http.createServer((request, response) => {
        endpoint.requests.push({
          url: request.url ?? "",
          authorization: request.headers.authorization,
        });
        response.writeHead(endpoint.status, { "Content-Type": "application/json" });
        response.end(endpoint.body);
      });
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
      fixture = await createTenancyFixture(prisma, ns);
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      await prisma.modelProvider.deleteMany({ where: { organizationId: fixture.organizationId } });
      await cleanupTenancyFixture(prisma, fixture);
      await prisma.$disconnect();
    });

    beforeEach(() => {
      rateLimits = MemoryModelProviderRateLimitRepository.create();
      endpoint.requests = [];
      listing([]);
    });

    describe("given an endpoint listing two models", () => {
      describe("when a new custom provider is saved", () => {
        /** @scenario Saving a new custom provider imports its models */
        it("stores both models and reports them imported", async () => {
          listing(["model-b", "model-a"]);

          const saved = await save({});

          expect(saved.modelImport).toEqual({ status: "imported", added: 2, total: 2 });
          expect(ids(await storedChat(saved.id))).toEqual(["model-a", "model-b"]);
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

          const saved = await save({
            id: created.id,
            customModels: [...(await storedChat(created.id)), manual],
          });

          expect(saved.modelImport).toEqual({ status: "imported", added: 0, total: 2 });
          const stored = await storedChat(created.id);
          expect(ids(stored)).toEqual(["model-a", "model-b", "manual-model"]);
          expect(stored.find((model) => model.id === "manual-model")).toMatchObject(manual);
          // The masked key was resolved to the stored one for the listing.
          expect(endpoint.requests.at(-1)?.authorization).toBe("Bearer sk-local-test");
        });
      });

      describe("when the endpoint starts listing another model", () => {
        /** @scenario Saving again imports models the endpoint added */
        it("adds the new model on the next save", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          listing(["model-a", "model-b", "model-c"]);

          const saved = await save({ id: created.id, customModels: await storedChat(created.id) });

          expect(saved.modelImport).toEqual({ status: "imported", added: 1, total: 3 });
          expect(ids(await storedChat(created.id))).toEqual(["model-a", "model-b", "model-c"]);
        });
      });

      describe("when the user removed an imported model", () => {
        /** @scenario Saving again does not bring back a model I removed */
        it("does not import it again while the endpoint still lists it", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const withoutA = (await storedChat(created.id)).filter((model) => model.id !== "model-a");

          await save({ id: created.id, customModels: withoutA });
          const again = await save({ id: created.id, customModels: await storedChat(created.id) });

          expect(again.modelImport).toEqual({ status: "imported", added: 0, total: 2 });
          expect(ids(await storedChat(created.id))).toEqual(["model-b"]);
        });
      });
    });

    describe("given a saved provider whose imported model was removed", () => {
      describe("when it is saved pointed at another endpoint", () => {
        /** @scenario Pointing the provider at another endpoint starts a fresh listing */
        it("imports the removed model from the new endpoint", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const withoutA = (await storedChat(created.id)).filter((model) => model.id !== "model-a");
          await save({ id: created.id, customModels: withoutA });

          // The same server under another host name is another endpoint.
          const saved = await save({
            id: created.id,
            customModels: await storedChat(created.id),
            endpointUrl: baseUrl.replace("127.0.0.1", "localhost"),
          });

          expect(saved.modelImport).toEqual({ status: "imported", added: 1, total: 2 });
          expect(ids(await storedChat(created.id))).toEqual(["model-b", "model-a"]);
        });
      });

      describe("when the new endpoint fails to list first and answers on a later save", () => {
        it("imports the removed model once the new endpoint answers", async () => {
          listing(["model-a", "model-b"]);
          const created = await save({});
          const withoutA = (await storedChat(created.id)).filter((model) => model.id !== "model-a");
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

          expect(saved.modelImport).toEqual({ status: "imported", added: 1, total: 2 });
          expect(ids(await storedChat(created.id))).toEqual(["model-b", "model-a"]);
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

        const saved = await save({ customModels: [manual] });

        expect(saved.modelImport).toEqual({ status: "failed" });
        expect(await storedChat(saved.id)).toMatchObject([manual]);
        const row = await prisma.modelProvider.findUniqueOrThrow({ where: { id: saved.id } });
        expect(row.lastListedModelIds).toBeNull();
      });
    });

    describe("given a check budget that cannot be read", () => {
      /** @scenario A check budget that cannot be read does not block the save */
      it("saves the models sent and reports the import failed without calling the endpoint", async () => {
        listing(["model-a"]);
        rateLimits = new UnreachableRateLimitRepository();

        const saved = await save({ customModels: [manual] });

        expect(saved.modelImport).toEqual({ status: "failed" });
        expect(await storedChat(saved.id)).toMatchObject([manual]);
        expect(endpoint.requests).toEqual([]);
      });
    });

    describe("given the organization used up its connection check budget", () => {
      /** @scenario An exhausted listing budget skips the import and keeps the save */
      it("saves the models sent and reports the import skipped without calling the endpoint", async () => {
        listing(["model-a"]);
        const limiter = WindowedModelProviderConnectionRateLimiterService.create({
          limiter: rateLimits,
        });
        await expect(async () => {
          for (let attempt = 0; attempt < 100; attempt++) {
            await limiter.assertAvailable({ organizationId: fixture.organizationId });
          }
        }).rejects.toThrow(ModelProviderTestRateLimitedError);

        const saved = await save({ customModels: [manual] });

        expect(saved.modelImport).toEqual({ status: "skipped" });
        expect(await storedChat(saved.id)).toMatchObject([manual]);
        expect(endpoint.requests).toEqual([]);
      });
    });
  },
);
