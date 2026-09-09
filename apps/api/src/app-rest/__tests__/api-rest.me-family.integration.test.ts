/**
 * @see specs/ai-governance/cli-onboarding/me-credentials.feature
 * The /me family over the process's REAL credential chain: the delivered
 * personal-project key resolves to its own workspace, or it does not.
 */
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import {
  REST_AUTH_ORGANIZATION,
  REST_AUTH_TEAM,
  REST_AUTH_USER,
  RestAuthWorld,
  type RestAuthProject,
} from "./support/rest-auth.world.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

/** The workspace device login mints, owned by the person the key names. */
const PERSONAL_PROJECT: RestAuthProject = {
  id: "project-personal-alpha",
  name: "Alpha's Workspace",
  slug: "personal-alpha",
  teamId: REST_AUTH_TEAM,
  organizationId: REST_AUTH_ORGANIZATION,
  isPersonal: true,
  ownerUserId: REST_AUTH_USER,
};

/** The `personal_project.api_key` the device-login exchange delivered. */
const DELIVERED_KEY = "sk-lw-personal-alpha";

/** A key minted for a job rather than for a person, on the same workspace. */
const SERVICE_KEY = "sk-lw-personal-alpha-service";

const USAGE = {
  summary: {
    spentUsd: 1.25,
    billedUsd: 1.25,
    requests: 3,
    promptTokens: 900,
    completionTokens: 300,
    mostUsedModel: { name: "gpt-5-mini", usagePct: 100 },
  },
  dailyBuckets: [{ day: "2026-09-01", spentUsd: 1.25, billedUsd: 1.25, requests: 3 }],
  breakdownByModel: [{ label: "gpt-5-mini", spentUsd: 1.25, billedUsd: 1.25, requests: 3 }],
};

describe("given the personal project key device login delivered", () => {
  describe("when the CLI reads the caller's usage with it", () => {
    /** @scenario the delivered personal key authenticates /api/me/usage */
    it("answers 200 with the usage rolled up for the key's own owner", async () => {
      const personalUsage = vi.fn(async () => USAGE);
      const api = mountMe(personalUsage);

      const response = await api.get("/api/me/usage", {
        authorization: `Bearer ${DELIVERED_KEY}`,
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ summary: USAGE.summary });
      expect(personalUsage).toHaveBeenCalledWith(
        expect.objectContaining({
          personalProjectId: PERSONAL_PROJECT.id,
          userId: REST_AUTH_USER,
        }),
      );
    });
  });

  describe("when the same read is attempted with no credential at all", () => {
    /** @scenario the delivered personal key authenticates /api/me/usage */
    it("refuses before any usage is rolled up, so the 200 above is the key's doing", async () => {
      const personalUsage = vi.fn(async () => USAGE);
      const api = mountMe(personalUsage);

      const response = await api.get("/api/me/usage");

      expect(response.status).toBe(401);
      expect(personalUsage).not.toHaveBeenCalled();
    });
  });
});

describe("given a service key on that same personal workspace", () => {
  describe("when it reads the personal usage", () => {
    /** @scenario "An ownerless service key is refused rather than answered as the owner" */
    it("refuses by name rather than answering as the workspace's owner", async () => {
      const personalUsage = vi.fn(async () => USAGE);
      const api = mountMe(personalUsage);

      const response = await api.get("/api/me/usage", {
        authorization: `Bearer ${SERVICE_KEY}`,
      });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "personal_usage_service_key_unsupported",
      });
      expect(personalUsage).not.toHaveBeenCalled();
    });
  });
});

function mountMe(personalUsage: () => Promise<typeof USAGE>): MountedRestFamily {
  const world = RestAuthWorld.create({
    projects: [PERSONAL_PROJECT],
    keys: [
      {
        token: DELIVERED_KEY,
        projectId: PERSONAL_PROJECT.id,
        userId: REST_AUTH_USER,
        apiKeyId: "api-key-personal",
        grants: ["project:view"],
      },
      {
        token: SERVICE_KEY,
        projectId: PERSONAL_PROJECT.id,
        userId: null,
        apiKeyId: "api-key-service",
        grants: ["project:view"],
      },
    ],
    organizations: [REST_AUTH_ORGANIZATION],
  });

  return mountRestFamily({
    security: world.security(),
    packaged: {
      governance: () => ({ personalUsage }),
      organizations: () =>
        ({
          tryGetOrganizationIdByTeamId: async () => REST_AUTH_ORGANIZATION,
        }) as unknown as OrganizationService,
      projects: () => ({ findInternal: async () => null }) as unknown as ProjectApi,
    } as never,
  });
}
