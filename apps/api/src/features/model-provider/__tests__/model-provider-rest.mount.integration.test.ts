/**
 * `/api/model-providers` and `/api/model-defaults`, mounted directly over a
 * fixture `ModelProviderApi`. The cascade family's own worth-pinning fact is
 * which credential shape reaches `getDefaultSnapshot` versus
 * `getDefaultSnapshotUnattributed` — the module's own suite covers the rest.
 */
// @vitest-environment node
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountModelDefaultsRest, mountModelProviderRest } from "../model-provider-rest.mount.ts";

const PROJECT_ID = "project-model-providers";
const ORGANIZATION_ID = "organization-model-providers";

function testRuntime(options: { apiKeyId: string | null; userId: string | null }) {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;

  return createApiRestRuntime({
    projectCredential: async () => ({
      ok: true as const,
      project: { id: PROJECT_ID },
      resolved: options.apiKeyId
        ? {
            type: "apiKey" as const,
            apiKeyId: options.apiKeyId,
            userId: options.userId,
            organizationId: ORGANIZATION_ID,
            ingestSourceType: null,
            ingestionTemplateId: null,
            project: {
              id: PROJECT_ID,
              name: "Model Providers",
              slug: "model-providers",
              teamId: "team-model-providers",
              organizationId: ORGANIZATION_ID,
              isPersonal: false,
              ownerUserId: null,
            },
          }
        : {
            type: "legacyProjectKey" as const,
            project: {
              id: PROJECT_ID,
              name: "Model Providers",
              slug: "model-providers",
              teamId: "team-model-providers",
              organizationId: ORGANIZATION_ID,
              isPersonal: false,
              ownerUserId: null,
            },
          },
      markUsed: () => void 0,
    }),
    organizationCredential: () => {
      throw new Error("This suite opens no organization credential door");
    },
    organizationIdentity: () => {
      throw new Error("This suite opens no organization credential door");
    },
    routeAuthorization: async () => ({ permitted: true, organizationRole: null }),
    errors,
  });
}

describe("given a project credential on /api/model-providers", () => {
  it("reaches the composed ModelProviderApi's getForProject", async () => {
    const runtime = testRuntime({ apiKeyId: "key-1", userId: "user-1" });
    const modelProviders = createApiFixture<ModelProviderApi>(
      { getForProject: async () => ({}) },
      "ModelProviderApi",
    );
    const mounted = mountModelProviderRest(runtime, () => modelProviders);

    const response = await mounted.fetch(
      new Request(`http://api.test/api/model-providers`, {
        headers: { "x-auth-token": "token" },
      }),
    );

    expect(response.status).toBe(200);
  });
});

describe("given /api/model-defaults", () => {
  describe("when the credential is an apiKey tied to a person", () => {
    it("reads the snapshot attributed to that person", async () => {
      const runtime = testRuntime({ apiKeyId: "key-1", userId: "user-1" });
      let attributedTo: unknown;
      const modelProviders = createApiFixture<ModelProviderApi>(
        {
          getDefaultSnapshot: async (_input, by) => {
            attributedTo = by;

            return {
              projectId: PROJECT_ID,
              teamId: "team-model-providers",
              organizationId: ORGANIZATION_ID,
              organizationName: "Org",
              effective: {},
              configs: [],
              available: { organization: null, teams: [], projects: [] },
              features: [],
            };
          },
        },
        "ModelProviderApi",
      );
      const mounted = mountModelDefaultsRest(runtime, () => modelProviders);

      const response = await mounted.fetch(
        new Request(`http://api.test/api/model-defaults`, {
          headers: { "x-auth-token": "token" },
        }),
      );

      expect(response.status).toBe(200);
      expect(attributedTo).toEqual({ id: "user-1" });
    });
  });

  describe("when the credential is a legacy project key", () => {
    it("reads the snapshot unattributed", async () => {
      const runtime = testRuntime({ apiKeyId: null, userId: null });
      let calledUnattributed = false;
      const modelProviders = createApiFixture<ModelProviderApi>(
        {
          getDefaultSnapshotUnattributed: async () => {
            calledUnattributed = true;

            return {
              projectId: PROJECT_ID,
              teamId: "team-model-providers",
              organizationId: ORGANIZATION_ID,
              organizationName: "Org",
              effective: {},
              configs: [],
              available: { organization: null, teams: [], projects: [] },
              features: [],
            };
          },
        },
        "ModelProviderApi",
      );
      const mounted = mountModelDefaultsRest(runtime, () => modelProviders);

      const response = await mounted.fetch(
        new Request(`http://api.test/api/model-defaults`, {
          headers: { "x-auth-token": "token" },
        }),
      );

      expect(response.status).toBe(200);
      expect(calledUnattributed).toBe(true);
    });
  });
});
