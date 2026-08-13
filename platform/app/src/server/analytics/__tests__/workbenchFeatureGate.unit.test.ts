/**
 * What the workbench switch is asked, and about whom.
 *
 * The flag service is faked because the real one reads the environment, Redis
 * and Postgres behind a 60-second cache — and because this repository's own
 * `.env` force-enables this very flag, so a test that consulted the real
 * service would answer "on" no matter what it was asked. Faking it is also what
 * makes the interesting claim observable: not the boolean that comes back, but
 * the context that goes in.
 *
 * @see specs/analytics/governed-sql-saved-charts.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "~/generated/prisma/client";

const isEnabled = vi.fn();

vi.mock("~/server/featureFlag", () => ({
  featureFlagService: {
    isEnabled: (...args: unknown[]) => isEnabled(...args),
  },
}));

import {
  GOVERNED_SQL_WORKBENCH_FLAG,
  workbenchEnabled,
} from "../workbenchFeatureGate";

/** A prisma that answers the one lookup the gate makes, and nothing else. */
function prismaAnswering(
  project: { team: { organizationId: string } | null } | null,
): PrismaClient {
  return {
    project: { findUnique: vi.fn().mockResolvedValue(project) },
  } as unknown as PrismaClient;
}

describe("the workbench feature gate", () => {
  beforeEach(() => {
    isEnabled.mockReset();
    isEnabled.mockResolvedValue(true);
  });

  describe("given a project that belongs to an organization", () => {
    describe("when the gate is consulted", () => {
      /** @scenario "The switch is decided for the project's organization, not for the project alone" */
      it("offers the organization alongside the member and the project", async () => {
        await workbenchEnabled({
          userId: "user-1",
          projectId: "project-1",
          prisma: prismaAnswering({ team: { organizationId: "org-1" } }),
        });

        expect(isEnabled).toHaveBeenCalledWith(GOVERNED_SQL_WORKBENCH_FLAG, {
          distinctId: "user-1",
          projectId: "project-1",
          organizationId: "org-1",
        });
      });
    });
  });

  describe("given a project the gate cannot read", () => {
    describe("when the gate is consulted", () => {
      /** @scenario "The switch is decided for the project's organization, not for the project alone" */
      it("names no organization rather than guessing one", async () => {
        await workbenchEnabled({
          userId: "user-1",
          projectId: "missing",
          prisma: prismaAnswering(null),
        });

        const [, options] = isEnabled.mock.calls[0] as [
          string,
          Record<string, unknown>,
        ];
        // Absent, not present-and-undefined: a rule matching on the
        // organization must not be handed a value we invented.
        expect("organizationId" in options).toBe(false);
        expect(options).toEqual({
          distinctId: "user-1",
          projectId: "missing",
        });
      });
    });
  });

  describe("given the switch answers off", () => {
    describe("when the gate is consulted", () => {
      it("reports off without deciding anything of its own", async () => {
        isEnabled.mockResolvedValue(false);

        expect(
          await workbenchEnabled({
            userId: "user-1",
            projectId: "project-1",
            prisma: prismaAnswering({ team: { organizationId: "org-1" } }),
          }),
        ).toBe(false);
      });
    });
  });
});
