/**
 * @vitest-environment node
 *
 * The identity the governed SQL gate buckets on.
 *
 * Both boundaries — the tRPC router and the REST route — ask through
 * `governedSqlEnabled`, so the identity it builds is the only one the flag
 * store ever sees for this surface. A percentage or distinct-ID rule keyed on
 * the wrong identity opens Custom query for one member of a project and closes
 * it for their teammate, and the REST caller is an API key with no member
 * behind it at all. These tests pin the identity itself, not merely that some
 * value reached the flag store.
 *
 * Spec: specs/analytics/governed-sql-workbench.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockIsEnabled } = vi.hoisted(() => ({
  mockIsEnabled: vi.fn().mockResolvedValue(true),
}));

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled: mockIsEnabled },
}));

import { GOVERNED_SQL_FLAG, governedSqlEnabled } from "../access";

/** A Prisma stand-in that resolves the given team, or none at all. */
function prismaResolving(
  team: { organizationId: string } | null,
): Parameters<typeof governedSqlEnabled>[0]["prisma"] {
  return {
    project: { findUnique: vi.fn().mockResolvedValue(team ? { team } : null) },
  } as unknown as Parameters<typeof governedSqlEnabled>[0]["prisma"];
}

describe("the governed SQL feature gate's identity", () => {
  beforeEach(() => {
    mockIsEnabled.mockClear();
    mockIsEnabled.mockResolvedValue(true);
  });

  describe("given a project that resolves to an organization", () => {
    /** @scenario "The switch is decided for the project's organization, not for the project alone" */
    it("buckets on the project, never on a member", async () => {
      await governedSqlEnabled({
        prisma: prismaResolving({ organizationId: "org-1" }),
        projectId: "project-1",
      });

      expect(mockIsEnabled).toHaveBeenCalledWith(GOVERNED_SQL_FLAG, {
        distinctId: "project-1",
        projectId: "project-1",
        organizationId: "org-1",
      });
    });
  });

  describe("given a project that cannot be read", () => {
    /** @scenario "The switch is decided for the project's organization, not for the project alone" */
    it("omits the organization key rather than passing it as undefined", async () => {
      await governedSqlEnabled({
        prisma: prismaResolving(null),
        projectId: "project-1",
      });

      const [, identity] = mockIsEnabled.mock.calls[0] as [
        string,
        Record<string, unknown>,
      ];
      // `in` is the distinction that matters: a rule matching on the
      // organization must not be handed a key this function guessed at.
      expect("organizationId" in identity).toBe(false);
      expect(identity.distinctId).toBe("project-1");
    });
  });

  describe("given the flag store's answer", () => {
    it("opens the surface when the flag is on", async () => {
      mockIsEnabled.mockResolvedValue(true);

      await expect(
        governedSqlEnabled({
          prisma: prismaResolving({ organizationId: "org-1" }),
          projectId: "project-1",
        }),
      ).resolves.toBe(true);
    });

    it("closes the surface when the flag is off", async () => {
      mockIsEnabled.mockResolvedValue(false);

      await expect(
        governedSqlEnabled({
          prisma: prismaResolving({ organizationId: "org-1" }),
          projectId: "project-1",
        }),
      ).resolves.toBe(false);
    });
  });
});
