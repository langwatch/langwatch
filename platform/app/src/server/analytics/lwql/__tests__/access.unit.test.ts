/**
 * @vitest-environment node
 *
 * The identity the LangWatchQL gate buckets on.
 *
 * Both boundaries — the tRPC router and the REST route — ask through
 * `lwqlEnabled`, so the identity it builds is the only one the flag
 * store ever sees for this surface. A percentage or distinct-ID rule keyed on
 * the wrong identity opens Custom query for one member of a project and closes
 * it for their teammate, and the REST caller is an API key with no member
 * behind it at all. These tests pin the identity itself, not merely that some
 * value reached the flag store.
 *
 * Spec: specs/analytics/lwql-workbench.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsEnabled } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: mockIsEnabled },
}));

import { NOT_TARGETED } from "~/server/featureFlag/targeting";
import { LWQL_FLAG, lwqlEnabled } from "../access";

/** A Prisma stand-in that resolves the given team, or none at all. */
function prismaResolving(
  team: { organizationId: string } | null,
): Parameters<typeof lwqlEnabled>[0]["prisma"] {
  return {
    project: { findUnique: vi.fn().mockResolvedValue(team ? { team } : null) },
  } as unknown as Parameters<typeof lwqlEnabled>[0]["prisma"];
}

describe("the LangWatchQL feature gate's identity", () => {
  beforeEach(() => {
    mockIsEnabled.mockClear();
    mockIsEnabled.mockResolvedValue(true);
  });

  describe("given a project that resolves to an organization", () => {
    /** @scenario "The switch is decided for the project's organization, not for the project alone" */
    it("buckets on the project, never on a member", async () => {
      await lwqlEnabled({
        prisma: prismaResolving({ organizationId: "org-1" }),
        projectId: "project-1",
      });

      expect(mockIsEnabled).toHaveBeenCalledWith(LWQL_FLAG, {
        distinctId: "project-1",
        projectId: "project-1",
        organizationId: "org-1",
      });
    });
  });

  describe("given a project that cannot be read", () => {
    /** @scenario "The switch is decided for the project's organization, not for the project alone" */
    it("states the organization as not targeted rather than guessing one", async () => {
      await lwqlEnabled({
        prisma: prismaResolving(null),
        projectId: "project-1",
      });

      const [, identity] = mockIsEnabled.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      // A rule matching on the organization must not be handed a value this
      // function guessed at, and the opt-out matches no such rule.
      expect(identity.organizationId).toBe(NOT_TARGETED);
      expect(identity.distinctId).toBe("project-1");
    });
  });

  describe("given the flag store's answer", () => {
    it("opens the surface when the flag is on", async () => {
      mockIsEnabled.mockResolvedValue(true);

      await expect(
        lwqlEnabled({
          prisma: prismaResolving({ organizationId: "org-1" }),
          projectId: "project-1",
        }),
      ).resolves.toBe(true);
    });

    it("closes the surface when the flag is off", async () => {
      mockIsEnabled.mockResolvedValue(false);

      await expect(
        lwqlEnabled({
          prisma: prismaResolving({ organizationId: "org-1" }),
          projectId: "project-1",
        }),
      ).resolves.toBe(false);
    });
  });
});
