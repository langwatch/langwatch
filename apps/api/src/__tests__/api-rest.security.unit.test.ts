import { requires } from "@langwatch/api";
import { ApiKeyService, type ResolvedApiKeyToken } from "@langwatch/api-key-contract";
import { AuthzService, type AuthzPermission } from "@langwatch/authz-contract";
import type { Logger } from "@langwatch/observability";
import { OrganizationNotFoundError, OrganizationService } from "@langwatch/organization-contract";
import { Hono } from "hono";
import type { Context } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiRestSecurity, type ApiRestProjectPolicy } from "../api-rest.security";
import { ApiRestObservabilityComposition } from "../app/api-rest-observability.composition";
import { ApiAuditPort } from "../api-request.policy";

const currentKey: ResolvedApiKeyToken = {
  type: "apiKey",
  apiKeyId: "key-1",
  userId: "user-1",
  organizationId: "org-1",
  ingestSourceType: null,
  ingestionTemplateId: null,
  project: {
    id: "project-1",
    name: "Project one",
    slug: "project-one",
    teamId: "team-1",
    organizationId: "org-1",
    isPersonal: false,
    ownerUserId: null,
  },
};

describe("ApiRestSecurity", () => {
  describe("when a project route authenticates", () => {
    it("passes the exact X-Project-Id target to canonical current-key resolution", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue(currentKey);
      const app = projectApp(policyOver({ apiKeys }));

      const response = await app.request("/api/secret", {
        headers: { authorization: "Bearer sk-lw-token", "X-Project-Id": "project-1" },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ projectId: "project-1" });
      expect(apiKeys.tryResolveToken).toHaveBeenCalledWith({
        token: "sk-lw-token",
        projectId: "project-1",
      });
    });

    it("keeps Basic's encoded project target and falls back to X-Auth-Token for malformed Basic", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue(currentKey);
      const app = projectApp(policyOver({ apiKeys }));

      await app.request("/api/secret", {
        headers: {
          authorization: `Basic ${Buffer.from("project-1:basic-token").toString("base64")}`,
        },
      });
      await app.request("/api/secret", {
        headers: { authorization: "Basic malformed", "X-Auth-Token": "fallback-token" },
      });

      expect(apiKeys.tryResolveToken).toHaveBeenNthCalledWith(1, {
        token: "basic-token",
        projectId: "project-1",
      });
      expect(apiKeys.tryResolveToken).toHaveBeenNthCalledWith(2, {
        token: "fallback-token",
        projectId: null,
      });
    });

    it("distinguishes missing credentials, which never reach resolution, from invalid ones", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue(null);
      const app = projectApp(policyOver({ apiKeys }));

      const missing = await app.request("/api/secret");
      const invalid = await app.request("/api/secret", {
        headers: { "X-Auth-Token": "bad-token" },
      });

      expect(missing.status).toBe(401);
      expect(invalid.status).toBe(401);
      expect(apiKeys.tryResolveToken).toHaveBeenCalledExactlyOnceWith({
        token: "bad-token",
        projectId: null,
      });
    });
  });

  describe("when a project route authorizes", () => {
    it("keeps legacy project keys actorless and outside the permission ceiling", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue({
        type: "legacyProjectKey",
        project: currentKey.project,
      });
      const authz = authzService();
      const policy = policyOver({ apiKeys, authz });
      const contexts: Context[] = [];
      const app = projectApp(policy, { permission: "secrets:manage", contexts });

      const response = await app.request("/api/secret", {
        headers: { "X-Auth-Token": "legacy-token" },
      });

      expect(response.status).toBe(200);
      expect(authz.hasApiKeyPermission).not.toHaveBeenCalled();
      expect(() => policy.actor(contexts[0]!)).toThrowError(
        expect.objectContaining({ code: "authenticated_actor_required" }),
      );
    });

    it("delegates current key ceilings to canonical AuthZ with resolved project lineage", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue(currentKey);
      const authz = authzService();
      authz.hasApiKeyPermission.mockResolvedValue(false);
      const app = projectApp(policyOver({ apiKeys, authz }), { permission: "secrets:manage" });

      const response = await app.request("/api/secret", {
        headers: { authorization: "Bearer current-token", "X-Project-Id": "project-1" },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_permission_denied",
      });
      expect(authz.hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key-1",
        userId: "user-1",
        organizationId: "org-1",
        scope: { type: "project", id: "project-1", teamId: "team-1" },
        permission: "secrets:manage",
      });
    });

    /** @scenario "A permission Langy is never delegated says so" */
    it("keeps Langy's never-delegable ceiling refusal distinct", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue({ ...currentKey, isLangySessionKey: true });
      const authz = authzService();
      authz.hasApiKeyPermission.mockResolvedValue(false);
      // Never delegable: secrets have no safe read. The original incident
      // grain was `triggers:create`, which is delegable since the 2026-08-21
      // widening (#7389).
      const app = projectApp(policyOver({ apiKeys, authz }), { permission: "secrets:view" });

      const response = await app.request("/api/secret", {
        headers: { authorization: "Bearer current-token", "X-Project-Id": "project-1" },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "api_key_permission_not_delegable",
      });
    });
  });

  describe("when a project request completes", () => {
    it("marks a current key as used and audits a successful attributed mutation", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue(currentKey);
      const audit = new TestAudit();
      const app = projectApp(policyOver({ apiKeys, audit }));

      const response = await app.request("/api/secret", {
        method: "POST",
        headers: { authorization: "Bearer current-token", "X-Project-Id": "project-1" },
      });

      expect(response.status).toBe(201);
      expect(apiKeys.markUsed).toHaveBeenCalledWith({ id: "key-1" });
      expect(audit.record).toHaveBeenCalledWith({
        actorId: "user-1",
        path: "/api/secret",
        input: { method: "POST", projectId: "project-1", status: 201 },
        error: null,
      });
    });

    it("does not mark or audit a legacy project key after a successful response", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue({
        type: "legacyProjectKey",
        project: currentKey.project,
      });
      const audit = new TestAudit();
      const app = projectApp(policyOver({ apiKeys, audit }));

      const response = await app.request("/api/secret", {
        method: "DELETE",
        headers: { "X-Auth-Token": "legacy-token" },
      });

      expect(response.status).toBe(200);
      expect(apiKeys.markUsed).not.toHaveBeenCalled();
      expect(audit.record).not.toHaveBeenCalled();
    });

    it("does not move the key's last-used clock for a refused request", async () => {
      const apiKeys = apiKeyService();
      apiKeys.tryResolveToken.mockResolvedValue(currentKey);
      const authz = authzService();
      authz.hasApiKeyPermission.mockResolvedValue(false);
      const app = projectApp(policyOver({ apiKeys, authz }), { permission: "secrets:manage" });

      await app.request("/api/secret", {
        headers: { authorization: "Bearer current-token", "X-Project-Id": "project-1" },
      });

      expect(apiKeys.markUsed).not.toHaveBeenCalled();
    });
  });

  describe("when an organization family authenticates", () => {
    it("uses the established header precedence while resolving an organization token", async () => {
      const apiKeys = apiKeyService();
      apiKeys.resolveOrganizationToken.mockResolvedValue({
        ok: true,
        resolved: {
          type: "apiKey-org",
          apiKeyId: "key-1",
          userId: "user-1",
          organizationId: "org-1",
        },
      });
      const app = organizationApp({ apiKeys });
      const basic = Buffer.from("project-ignored:pat-lw-basic").toString("base64");

      const response = await app.request("/api/org-probe", {
        headers: {
          authorization: `Basic ${basic}`,
          "x-auth-token": "fallback-token",
          "x-project-id": "also-ignored",
        },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ organizationId: "org-1" });
      expect(apiKeys.resolveOrganizationToken).toHaveBeenCalledWith({ token: "pat-lw-basic" });
    });

    it("keeps wrong credential class actionable and unusable credentials opaque", async () => {
      const apiKeys = apiKeyService();
      apiKeys.resolveOrganizationToken.mockResolvedValue({
        ok: false,
        reason: "wrong_credential_class",
      });
      const app = organizationApp({ apiKeys });

      const mismatch = await app.request("/api/org-probe", {
        headers: { authorization: "Bearer sk-lw-project" },
      });

      expect(mismatch.status).toBe(401);
      await expect(mismatch.json()).resolves.toMatchObject({
        required: "organization_api_key",
        presented: "project_api_key",
      });

      apiKeys.resolveOrganizationToken.mockResolvedValue({
        ok: false,
        reason: "unusable_credential",
      });
      const unusable = await app.request("/api/org-probe", {
        headers: { authorization: "Bearer pat-lw-revoked" },
      });

      expect(unusable.status).toBe(401);
      await expect(unusable.json()).resolves.not.toHaveProperty("required");
    });

    it("preserves an orphaned organization's 401", async () => {
      const apiKeys = apiKeyService();
      apiKeys.resolveOrganizationToken.mockResolvedValue({
        ok: true,
        resolved: {
          type: "apiKey-org",
          apiKeyId: "key-1",
          userId: "user-1",
          organizationId: "org-1",
        },
      });
      const organizations = organizationService();
      organizations.getSettings.mockRejectedValue(new OrganizationNotFoundError());
      const logger = testLogger();
      const app = organizationApp({ apiKeys, organizations, logger });

      const response = await app.request("/api/org-probe", {
        headers: { authorization: "Bearer pat-lw-orphaned" },
      });

      expect(response.status).toBe(401);
      expect(logger.error).not.toHaveBeenCalled();
    });

    /** @scenario A database failure loading the organization answers the family's server error */
    it("logs the cause when credential resolution itself fails", async () => {
      const apiKeys = apiKeyService();
      const failure = new Error("credential store unreachable");
      apiKeys.resolveOrganizationToken.mockRejectedValue(failure);
      const logger = testLogger();
      const app = organizationApp({ apiKeys, logger });

      const response = await app.request("/api/org-probe", {
        headers: { authorization: "Bearer pat-lw-token" },
      });

      expect(response.status).toBe(500);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ error: failure, method: "GET", path: "/api/org-probe" }),
        expect.any(String),
      );
    });

    it("logs the cause when the organization lookup fails for a reason other than absence", async () => {
      const apiKeys = apiKeyService();
      apiKeys.resolveOrganizationToken.mockResolvedValue({
        ok: true,
        resolved: {
          type: "apiKey-org",
          apiKeyId: "key-1",
          userId: "user-1",
          organizationId: "org-1",
        },
      });
      const organizations = organizationService();
      const failure = new Error("organization store unreachable");
      organizations.getSettings.mockRejectedValue(failure);
      const logger = testLogger();
      const app = organizationApp({ apiKeys, organizations, logger });

      const response = await app.request("/api/org-probe", {
        headers: { authorization: "Bearer pat-lw-token" },
      });

      expect(response.status).toBe(500);
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          error: failure,
          method: "GET",
          path: "/api/org-probe",
          organizationId: "org-1",
        }),
        expect.any(String),
      );
    });

    it("authorizes the declared permission at the organization's own scope", async () => {
      const apiKeys = apiKeyService();
      apiKeys.resolveOrganizationToken.mockResolvedValue({
        ok: true,
        resolved: { type: "apiKey-org", apiKeyId: "key-1", userId: null, organizationId: "org-1" },
      });
      const authz = authzService();
      authz.hasApiKeyPermission.mockResolvedValue(false);
      const app = organizationApp({ apiKeys, authz });

      const response = await app.request("/api/org-probe", {
        headers: { authorization: "Bearer sk-lw-service" },
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        required_permission: "organization:view",
      });
      expect(authz.hasApiKeyPermission).toHaveBeenCalledWith({
        apiKeyId: "key-1",
        userId: null,
        organizationId: "org-1",
        scope: { type: "org", id: "org-1" },
        permission: "organization:view",
      });
    });
  });
});

function policyOver(fakes: {
  apiKeys: ReturnType<typeof apiKeyService>;
  authz?: ReturnType<typeof authzService>;
  audit?: TestAudit;
}): ApiRestProjectPolicy {
  return ApiRestSecurity.projectPolicy({
    apiKeys: fakes.apiKeys.service,
    authz: (fakes.authz ?? authzService()).service,
    organizations: organizationService().service,
    ...(fakes.audit ? { audit: fakes.audit } : {}),
  });
}

function projectApp(
  policy: ApiRestProjectPolicy,
  options: { permission?: AuthzPermission; contexts?: Context[] } = {},
) {
  const app = new Hono<{ Variables: { project?: { id: string } } }>();
  app.use("*", policy.authenticationMiddleware());
  if (options.permission) {
    app.use("*", policy.permissionMiddleware(options.permission));
  }
  app.all("*", (context) => {
    options.contexts?.push(context);
    const project = context.get("project");
    return context.json(
      { projectId: project?.id ?? null },
      context.req.method === "POST" ? 201 : 200,
    );
  });
  return app;
}

function organizationApp(fakes: {
  apiKeys: ReturnType<typeof apiKeyService>;
  authz?: ReturnType<typeof authzService>;
  organizations?: ReturnType<typeof organizationService>;
  logger?: ReturnType<typeof testLogger>;
}) {
  const security = ApiRestSecurity.create({
    apiKeys: fakes.apiKeys.service,
    authz: (fakes.authz ?? authzService()).service,
    organizations: (fakes.organizations ?? organizationService()).service,
    observability: ApiRestObservabilityComposition.create(),
    ...(fakes.logger ? { logger: fakes.logger } : {}),
  });
  const secured = security.createOrgApp({ basePath: "/api/org-probe" });
  secured.access(requires("organization:view")).get("/", (context) => {
    return context.json({ organizationId: context.get("organization").id });
  });
  return secured.hono;
}

class TestAudit extends ApiAuditPort {
  readonly record = vi.fn(async () => undefined);
}

function testLogger() {
  return { error: vi.fn<Logger["error"]>() };
}

function apiKeyService() {
  const tryResolveToken = vi.fn<ApiKeyService["tryResolveToken"]>();
  const resolveOrganizationToken = vi.fn<ApiKeyService["resolveOrganizationToken"]>();
  const markUsed = vi.fn();
  const service = new Proxy(ApiKeyService.prototype, {
    get(target, property, receiver) {
      if (property === "tryResolveToken") return tryResolveToken;
      if (property === "resolveOrganizationToken") return resolveOrganizationToken;
      if (property === "markUsed") return markUsed;
      return Reflect.get(target, property, receiver);
    },
  });
  return { service, tryResolveToken, resolveOrganizationToken, markUsed };
}

function authzService() {
  const hasApiKeyPermission = vi.fn<AuthzService["hasApiKeyPermission"]>().mockResolvedValue(true);
  const service = new Proxy(AuthzService.prototype, {
    get(target, property, receiver) {
      return property === "hasApiKeyPermission"
        ? hasApiKeyPermission
        : Reflect.get(target, property, receiver);
    },
  });
  return { service, hasApiKeyPermission };
}

function organizationService() {
  const getSettings = vi.fn<OrganizationService["getSettings"]>().mockResolvedValue({
    id: "org-1",
    name: "Organization one",
    slug: "organization-one",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3Bucket: null,
    createdAt: new Date("2026-08-28T00:00:00.000Z"),
    updatedAt: new Date("2026-08-28T00:00:00.000Z"),
  });
  const service = new Proxy(OrganizationService.prototype, {
    get(target, property, receiver) {
      return property === "getSettings" ? getSettings : Reflect.get(target, property, receiver);
    },
  });
  return { service, getSettings };
}
