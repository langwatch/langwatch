/**
 * The orphan-config backstop on the `/api/model-defaults` writes, answered by
 * the API process's own REST boundary rather than a test double of it.
 * @vitest-environment node
 */
import {
  createAppRestSecurity,
  type AppRestSecurity,
  type RestApiServicePorts,
} from "@langwatch/api/rest";
import { ModelDefaultNotFoundError } from "@langwatch/model-provider-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { createModelDefaultsRestApp } from "@langwatch/model-provider-server";
import type { MiddlewareHandler } from "hono";
import { describe, expect, it, vi } from "vitest";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";

const pass: MiddlewareHandler = async (_c, next) => next();

const authenticateProject: MiddlewareHandler = async (c, next) => {
  c.set("project", {
    id: "project-1",
    name: "Project One",
    slug: "project-one",
    teamId: "team-1",
    organizationId: "organization-1",
    isPersonal: false,
    ownerUserId: null,
  });
  c.set("apiKeyUserId", "owner-user");
  await next();
};

/** The permitted key: the ceiling passes, so only the ownership backstop can refuse. */
function permittedSecurity(scopeChecks: string[]): AppRestSecurity {
  const ports: RestApiServicePorts = {
    ...ApiRestObservabilityComposition.create(),
    authenticateProject: () => authenticateProject,
    authorizeProjectPermission: ({ permission }) => {
      scopeChecks.push(permission);
      return pass;
    },
    authorizeApiKeyCeiling: () => pass,
    authenticateOrganization: () => pass,
    authorizeOrganizationPermission: () => pass,
    authorizeRouteTeamPermission: () => pass,
    authorizeRouteProjectPermission: () => pass,
    authenticateOrganizationThrowing: pass,
    authorizeOrganizationPermissionThrowing: () => pass,
  };
  return createAppRestSecurity(ports);
}

function mount(modelProviders: Partial<ModelProviderService>) {
  const scopeChecks: string[] = [];
  const family = createModelDefaultsRestApp({
    security: permittedSecurity(scopeChecks),
    modelProviders: () => modelProviders as ModelProviderService,
  });
  return { hono: family.hono, scopeChecks };
}

const WRITE_BODY = JSON.stringify({
  config: { DEFAULT: "openai/gpt-5-mini" },
  scopes: [{ scopeType: "ORGANIZATION", scopeId: "organization-1" }],
});

describe("given a model-defaults config id that resolves to no scope attachments", () => {
  describe("when an authenticated caller updates it", () => {
    /** @scenario "A model-defaults config with no scope attachments is treated as not found" */
    it("answers 404 when the write service reports the config missing", async () => {
      const saveDefaultConfig = vi.fn(async () => {
        throw new ModelDefaultNotFoundError();
      });
      const { hono, scopeChecks } = mount({ saveDefaultConfig });

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults/cfg_does_not_exist", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: WRITE_BODY,
        }),
      );

      expect(response.status).toBe(404);
      expect(scopeChecks).not.toContain("project:manage");
    });

    /** @scenario "A model-defaults config with no scope attachments is treated as not found" */
    it("answers 404, not 500, when the ownership backstop refuses", async () => {
      // The backstop the handler keeps for a service that answers nothing at
      // all rather than refusing: it must still read as not-found.
      const saveDefaultConfig: ModelProviderService["saveDefaultConfig"] = vi.fn(
        async () => undefined as never,
      );
      const { hono } = mount({ saveDefaultConfig });

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults/cfg_does_not_exist", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: WRITE_BODY,
        }),
      );

      expect(response.status).toBe(404);
      const body = (await response.json()) as Record<string, unknown>;
      expect(JSON.stringify(body)).not.toContain("An unknown error occurred");
    });
  });

  describe("when an authenticated caller deletes it", () => {
    /** @scenario "A model-defaults config with no scope attachments is treated as not found" */
    it("answers 404 and the per-scope write check never runs", async () => {
      const deleteDefaultConfig = vi.fn(async () => {
        throw new ModelDefaultNotFoundError();
      });
      const { hono, scopeChecks } = mount({ deleteDefaultConfig });

      const response = await hono.request(
        new Request("http://localhost/api/model-defaults/cfg_does_not_exist", {
          method: "DELETE",
        }),
      );

      expect(response.status).toBe(404);
      expect(scopeChecks).not.toContain("project:manage");
    });
  });
});
