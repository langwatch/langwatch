/**
 * @see specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 * ADR-092 §9 caps a CLI key at what its owner may still do, read at request
 * time: the project door refuses, the listing narrows instead of refusing.
 */
import type { ProjectService } from "@langwatch/project-contract";
import { describe, expect, it, vi } from "vitest";

import type { ApiTracesRestCollaborators } from "../../features/trace/trace-rest.mount";
import {
  REST_AUTH_ORGANIZATION,
  REST_AUTH_PROJECT,
  RestAuthWorld,
  type RestAuthKey,
  type RestAuthProject,
} from "./support/rest-auth.world";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness";

/** A second team's project in the SAME organization: what the owner loses. */
const OTHER_TEAM_PROJECT: RestAuthProject = {
  id: "project-gamma",
  name: "Gamma",
  slug: "gamma",
  teamId: "team-gamma",
  organizationId: REST_AUTH_ORGANIZATION,
  isPersonal: false,
  ownerUserId: null,
};

const CLI_KEY = "sk-lw-cli-login";
const PROJECTS = [REST_AUTH_PROJECT, OTHER_TEAM_PROJECT];

function worldFor(key: RestAuthKey): RestAuthWorld {
  return RestAuthWorld.create({
    projects: PROJECTS,
    keys: [key],
    organizations: [REST_AUTH_ORGANIZATION],
  });
}

describe("given a CLI key minted while its owner covered the whole organization", () => {
  describe("when the owner is demoted and the key searches traces on a project they can no longer view", () => {
    /** @scenario "the key can never exceed the owner's live permissions" */
    it("refuses with a 403 and never reaches the trace store", async () => {
      const readTraces = vi.fn(async () => ({ groups: [], traceChecks: {}, totalHits: 0 }));
      const beforeDemotion = mountTraces({
        world: worldFor({
          token: CLI_KEY,
          projectId: OTHER_TEAM_PROJECT.id,
          apiKeyId: "key-cli",
          grants: ["traces:view"],
        }),
        readTraces,
      });

      // Positive control: with no ceiling in play the key reaches the project,
      // so the refusal below is the ceiling and not a broken fixture.
      const allowed = await beforeDemotion.post("/api/traces/search", searchBody(), bearer());
      expect(allowed.status).toBe(200);

      const afterDemotion = mountTraces({
        world: worldFor({
          token: CLI_KEY,
          projectId: OTHER_TEAM_PROJECT.id,
          apiKeyId: "key-cli",
          grants: ["traces:view"],
          // Demoted: still a member of the organization, no longer reaching
          // this team's projects.
          ownerGrants: ["traces:view"],
          ownerProjectIds: [REST_AUTH_PROJECT.id],
        }),
        readTraces,
      });
      readTraces.mockClear();

      const refused = await afterDemotion.post("/api/traces/search", searchBody(), bearer());

      expect(refused.status).toBe(403);
      expect(readTraces).not.toHaveBeenCalled();
    });
  });

  describe("when the key lists the organization's projects after the owner lost a team", () => {
    /** @scenario "the filtered list respects the owner's ceiling" */
    it("answers 200 with that team's projects absent rather than refusing", async () => {
      const world = worldFor({
        token: CLI_KEY,
        kind: "organization",
        organizationId: REST_AUTH_ORGANIZATION,
        apiKeyId: "key-cli",
        grants: ["project:view"],
        ownerGrants: ["project:view"],
        ownerProjectIds: [REST_AUTH_PROJECT.id],
      });
      const listByOrganization = vi.fn(async ({ projectIds }: { projectIds?: string[] }) => ({
        data: PROJECTS.filter((project) => !projectIds || projectIds.includes(project.id)),
        pagination: { page: 1, limit: 25, totalCount: 0, totalPages: 1 },
      }));
      const api = mountProjects({ world, listByOrganization });

      const response = await api.get("/api/projects", bearer());

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { id: string }[] };
      expect(body.data.map((project) => project.id)).toEqual([REST_AUTH_PROJECT.id]);
      expect(listByOrganization).toHaveBeenCalledWith(
        expect.objectContaining({ projectIds: [REST_AUTH_PROJECT.id] }),
      );
    });
  });
});

/** The narrowest body the v1 search validator accepts. */
function searchBody(): Record<string, unknown> {
  return { startDate: Date.now() - 60_000, endDate: Date.now() };
}

function bearer(): Record<string, string> {
  return { authorization: `Bearer ${CLI_KEY}` };
}

function mountTraces(options: {
  world: RestAuthWorld;
  readTraces: () => Promise<{ groups: unknown[]; traceChecks: object; totalHits: number }>;
}): MountedRestFamily {
  const traceReads = {
    reads: {
      readers: () => ({ read: { getAllTracesForProject: options.readTraces } }),
      getApiKeyProtections: async () => ({ canSeeCapturedInput: true, canSeeCapturedOutput: true }),
    },
    platformUrl: () => "https://app.langwatch.test/acme/traces",
  } as unknown as ApiTracesRestCollaborators;

  return mountRestFamily({
    security: options.world.security(),
    services: { traceReads },
  });
}

function mountProjects(options: {
  world: RestAuthWorld;
  listByOrganization: (input: { projectIds?: string[] }) => Promise<unknown>;
}): MountedRestFamily {
  return mountRestFamily({
    security: options.world.security(),
    packaged: {
      projects: () =>
        ({
          listByOrganization: options.listByOrganization,
        }) as unknown as ProjectService,
      apiKeys: () => options.world.apiKeys(),
    } as never,
  });
}
