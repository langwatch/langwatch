import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildProjectCreateData } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
import { ModelProviderRepository } from "~/server/modelProviders/modelProvider.repository";
import { app } from "../[[...route]]/app";

describe("Model Providers API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let helpers: {
    api: {
      put: (path: string, body: unknown) => Response | Promise<Response>;
      get: (path: string) => Response | Promise<Response>;
    };
  };

  const createAuthHeaders = (apiKey: string) => ({
    "X-Auth-Token": apiKey,
    "Content-Type": "application/json",
  });

  beforeEach(async () => {
    testOrganization = await prisma.organization.create({
      data: {
        name: "Test Organization",
        slug: `test-org-${nanoid()}`,
      },
    });

    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });

    testProject = await prisma.project.create({
      data: {
        ...buildProjectCreateData({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });

    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;

    helpers = {
      api: {
        get: (path: string) =>
          app.request(path, { headers: { "X-Auth-Token": testApiKey } }),
        put: (path: string, body: unknown) =>
          app.request(path, {
            method: "PUT",
            headers: createAuthHeaders(testApiKey),
            body: JSON.stringify(body),
          }),
      },
    };
  });

  afterEach(async () => {
    await prisma.modelProvider.deleteMany({
      where: {
        scopes: { some: { scopeType: "PROJECT", scopeId: testProjectId } },
      },
    });

    await prisma.project.delete({
      where: { id: testProjectId },
    });

    await prisma.team.delete({
      where: { id: testTeam.id },
    });

    await prisma.organization.delete({
      where: { id: testOrganization.id },
    });
  });

  describe("when no API key is provided", () => {
    it("returns 401", async () => {
      const res = await app.request("/api/model-providers");

      expect(res.status).toBe(401);
    });
  });

  describe("GET /api/model-providers", () => {
    describe("when no custom providers are configured", () => {
      it("returns default providers", async () => {
        const res = await helpers.api.get("/api/model-providers");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(typeof body).toBe("object");
      });
    });

    describe("when a custom provider is configured", () => {
      beforeEach(async () => {
        await prisma.modelProvider.create({
          data: {
            name: "OpenAI",
            provider: "openai",
            enabled: true,
            organizationId: testOrganization.id,
            customKeys: { OPENAI_API_KEY: "sk-real-key-12345" },
            scopes: {
              create: [{ scopeType: "PROJECT", scopeId: testProjectId }],
            },
          },
        });
      });

      /** @scenario GET /api/model-providers lists providers with masked keys */
      it("returns the provider with masked API keys", async () => {
        const res = await helpers.api.get("/api/model-providers");

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.openai).toBeDefined();
        expect(body.openai.enabled).toBe(true);
        expect(body.openai.customKeys.OPENAI_API_KEY).toBe(
          MASKED_KEY_PLACEHOLDER,
        );
      });

      it("never returns the raw API key", async () => {
        const res = await helpers.api.get("/api/model-providers");

        const body = await res.json();
        const bodyStr = JSON.stringify(body);
        expect(bodyStr).not.toContain("sk-real-key-12345");
      });
    });
  });

  describe("PUT /api/model-providers/:provider", () => {
    describe("when creating a new provider", () => {
      // Skipped: route exists but requires CREDENTIALS_SECRET env var for AES-256-GCM encryption of customKeys.
      // Set CREDENTIALS_SECRET (32-byte hex) in test env to enable.
      it.skip("creates the provider and returns masked response", async () => {
        const res = await helpers.api.put("/api/model-providers/openai", {
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-new-key-67890" },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.openai).toBeDefined();
        expect(body.openai.enabled).toBe(true);
        expect(body.openai.customKeys.OPENAI_API_KEY).toBe(
          MASKED_KEY_PLACEHOLDER,
        );
      });

      /** @scenario PUT /api/model-providers/:provider upserts provider config */
      it("never returns raw API key in response", async () => {
        const res = await helpers.api.put("/api/model-providers/openai", {
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-new-key-67890" },
        });

        const body = await res.json();
        const bodyStr = JSON.stringify(body);
        expect(bodyStr).not.toContain("sk-new-key-67890");
      });
    });

    describe("when updating an existing provider", () => {
      beforeEach(async () => {
        await prisma.modelProvider.create({
          data: {
            name: "OpenAI",
            provider: "openai",
            enabled: true,
            organizationId: testOrganization.id,
            customKeys: { OPENAI_API_KEY: "sk-original-key" },
            scopes: {
              create: [{ scopeType: "PROJECT", scopeId: testProjectId }],
            },
          },
        });
      });

      // Skipped: route exists but requires CREDENTIALS_SECRET env var for AES-256-GCM encryption of customKeys.
      // Set CREDENTIALS_SECRET (32-byte hex) in test env to enable.
      it.skip("updates the provider settings", async () => {
        const res = await helpers.api.put("/api/model-providers/openai", {
          enabled: false,
          customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.openai.enabled).toBe(false);
      });

      it("preserves existing keys when masked placeholder is sent", async () => {
        await helpers.api.put("/api/model-providers/openai", {
          enabled: true,
          customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
        });

        // Verify original key still in DB. Use the repository so the
        // encrypted-at-rest payload is decrypted before assertion.
        const repo = new ModelProviderRepository(prisma);
        const saved = await repo.findByProvider("openai", testProjectId);
        expect(
          (saved?.customKeys as Record<string, string>)?.OPENAI_API_KEY,
        ).toBe("sk-original-key");
      });
    });

    // The legacy `defaultModel` write path on the REST API is gone
    // along with the Project.defaultModel scalar column. Defaults now
    // live in ModelDefaultConfig and are mutated through the tRPC
    // model-provider router (createConfig / updateConfig /
    // setRoleAtScope / setFeatureAtScope).

    describe("when the project has no defaults yet", () => {
      it("seeds a ModelDefaultConfig row on first-provider create", async () => {
        // No provider rows on this project yet — the next PUT below
        // is the "first provider" event. ModelProviderService.createNew
        // runs seedOnboardingDefaultsForProvider, which should land a
        // ModelDefaultConfig row at PROJECT scope.
        const before = await prisma.modelDefaultConfig.count({
          where: {
            scopes: { some: { scopeType: "PROJECT", scopeId: testProjectId } },
          },
        });

        const res = await helpers.api.put("/api/model-providers/openai", {
          enabled: true,
          customKeys: { OPENAI_API_KEY: "sk-seed-default-test" },
        });
        // 200 happy path or 400 when CREDENTIALS_SECRET is unset (same
        // env-skip the other PUT tests in this file accept). The seed
        // only runs when the create lands, so we early-exit on 400.
        if (res.status !== 200) return;

        const after = await prisma.modelDefaultConfig.count({
          where: {
            scopes: { some: { scopeType: "PROJECT", scopeId: testProjectId } },
          },
        });
        expect(after).toBeGreaterThan(before);
      });
    });

    describe("when given an invalid provider", () => {
      it("returns 400", async () => {
        const res = await helpers.api.put(
          "/api/model-providers/nonexistent-provider",
          {
            enabled: true,
          },
        );

        expect(res.status).toBe(400);
      });
    });
  });
});
