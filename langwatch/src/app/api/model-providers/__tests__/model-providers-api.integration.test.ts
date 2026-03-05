import type { Organization, Project, Team } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import { prisma } from "~/server/db";
import { MASKED_KEY_PLACEHOLDER } from "~/utils/constants";
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

    testProject = projectFactory.build({
      slug: nanoid(),
    });
    testProject = await prisma.project.create({
      data: {
        ...testProject,
        teamId: testTeam.id,
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
      where: { projectId: testProjectId },
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
            projectId: testProjectId,
            provider: "openai",
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-real-key-12345" },
          },
        });
      });

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
      it("creates the provider and returns masked response", async () => {
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
            projectId: testProjectId,
            provider: "openai",
            enabled: true,
            customKeys: { OPENAI_API_KEY: "sk-original-key" },
          },
        });
      });

      it("updates the provider settings", async () => {
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

        // Verify original key still in DB
        const saved = await prisma.modelProvider.findFirst({
          where: { projectId: testProjectId, provider: "openai" },
        });
        expect(
          (saved?.customKeys as Record<string, string>)?.OPENAI_API_KEY,
        ).toBe("sk-original-key");
      });
    });

    describe("when setting defaultModel without provider prefix", () => {
      it("stores defaultModel with provider prefix prepended", async () => {
        const res = await helpers.api.put("/api/model-providers/openai", {
          enabled: true,
          defaultModel: "gpt-4o",
        });

        expect(res.status).toBe(200);

        const project = await prisma.project.findUnique({
          where: { id: testProjectId },
        });
        expect(project?.defaultModel).toBe("openai/gpt-4o");
      });
    });

    describe("when setting defaultModel with provider prefix already", () => {
      it("stores defaultModel as-is without double-prefixing", async () => {
        const res = await helpers.api.put("/api/model-providers/openai", {
          enabled: true,
          defaultModel: "openai/gpt-4o",
        });

        expect(res.status).toBe(200);

        const project = await prisma.project.findUnique({
          where: { id: testProjectId },
        });
        expect(project?.defaultModel).toBe("openai/gpt-4o");
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
