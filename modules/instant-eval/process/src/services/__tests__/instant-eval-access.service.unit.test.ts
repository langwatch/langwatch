/**
 * The gate: two conditions, and the one that costs nothing is checked first.
 * Both tests state the deployment's configuration rather than reading it.
 * @see specs/lwql/eval-functions.feature
 */

import { describe, expect, it } from "vitest";

import {
  type InstantEvalFlagReader,
  InstantEvalAccessService,
  type InstantEvalOptInReader,
  type InstantEvalProjectReader,
} from "../instant-eval-access.service.ts";

const REACHED = "the gate read the project";

/** A project reader that fails loudly, so a reach for it is observable. */
const LOUD_PROJECTS: InstantEvalProjectReader = {
  findOrganizationId: () => {
    throw new Error(REACHED);
  },
};

const LOUD_FLAGS: InstantEvalFlagReader = {
  isEnabled: () => {
    throw new Error("the gate resolved the flag");
  },
};

function gate({
  isJudgeConfigured,
  flags = LOUD_FLAGS,
  projects = LOUD_PROJECTS,
}: {
  isJudgeConfigured: () => boolean;
  flags?: InstantEvalFlagReader;
  projects?: InstantEvalProjectReader;
}) {
  return InstantEvalAccessService.create({
    flags,
    projects,
    isJudgeConfigured,
    optIns: NEVER_OPTED_IN,
  });
}

const NEVER_OPTED_IN: InstantEvalOptInReader = { isOptedIn: async () => false };

describe("given a deployment with no judge configured", () => {
  describe("when a project asks whether it may judge", () => {
    /** @scenario "An eval function is refused when the deployment has no classifier" */
    it("answers no without resolving the flag or reading the project", async () => {
      await expect(
        gate({ isJudgeConfigured: () => false }).isEnabled({ projectId: "project-1" }),
      ).resolves.toBe(false);
    });
  });
});

describe("given a deployment with a judge configured", () => {
  describe("when a project asks whether it may judge", () => {
    it("goes on to the flag, which needs the project's organization", async () => {
      await expect(
        gate({ isJudgeConfigured: () => true }).isEnabled({ projectId: "project-1" }),
      ).rejects.toThrow(REACHED);
    });

    it("asks the flag for the project, carrying the organization it belongs to", async () => {
      const asked: { flagKey: string; target: Record<string, unknown> }[] = [];
      const enabled = await gate({
        isJudgeConfigured: () => true,
        projects: { findOrganizationId: async () => "organization-1" },
        flags: {
          isEnabled: async (flagKey, target) => {
            asked.push({ flagKey, target });
            return true;
          },
        },
      }).isEnabled({ projectId: "project-1" });

      expect(enabled).toBe(true);
      expect(asked).toEqual([
        {
          flagKey: "release_instant_evals",
          target: { kind: "project", projectId: "project-1", organizationId: "organization-1" },
        },
      ]);
    });

    it("asks without an organization for a project that belongs to none", async () => {
      const targets: Record<string, unknown>[] = [];
      await gate({
        isJudgeConfigured: () => true,
        projects: { findOrganizationId: async () => undefined },
        flags: {
          isEnabled: async (_flagKey, target) => {
            targets.push(target);
            return false;
          },
        },
      }).isEnabled({ projectId: "project-1" });

      expect(targets).toEqual([{ kind: "project", projectId: "project-1" }]);
    });
  });

  describe("when the product decision alone is asked", () => {
    it("answers the flag whether or not a judge is configured", async () => {
      const released = gate({
        isJudgeConfigured: () => false,
        projects: { findOrganizationId: async () => undefined },
        flags: { isEnabled: async () => true },
      });

      await expect(released.isReleased({ projectId: "project-1" })).resolves.toBe(true);
      await expect(released.isEnabled({ projectId: "project-1" })).resolves.toBe(false);
    });
  });
});

describe("given a judge that judges for some organizations and not others", () => {
  const released: InstantEvalFlagReader = { isEnabled: async () => true };
  const projects: InstantEvalProjectReader = { findOrganizationId: async () => "organization-1" };

  describe("when the project's organization has not switched hosted judging on", () => {
    /** @scenario "An install with the service off publishes eval functions as unavailable" */
    it("answers no, so the eval functions read as unavailable rather than skipped", async () => {
      const asked: string[] = [];
      const access = InstantEvalAccessService.create({
        flags: released,
        projects,
        isJudgeConfigured: () => true,
        optIns: NEVER_OPTED_IN,
        judge: {
          isAvailableForOrganization: async (organizationId) => {
            asked.push(organizationId);
            return false;
          },
        },
      });

      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(false);
      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(true);
      expect(asked).toEqual(["organization-1"]);
    });
  });

  describe("when the organization has it on", () => {
    it("goes on to the release flag", async () => {
      const access = InstantEvalAccessService.create({
        flags: released,
        projects,
        isJudgeConfigured: () => true,
        optIns: NEVER_OPTED_IN,
        judge: { isAvailableForOrganization: async () => true },
      });

      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
    });
  });
});

describe("given the flag is off and the organization switched Instant Evals on itself", () => {
  describe("when a project of that organization asks whether it may judge", () => {
    /** @scenario "An organization that switched itself on is judged without the flag" */
    it("answers yes from the organization's switch", async () => {
      const asked: string[] = [];
      const access = InstantEvalAccessService.create({
        flags: { isEnabled: async () => false },
        projects: { findOrganizationId: async () => "organization" },
        isJudgeConfigured: () => true,
        judge: { isAvailableForOrganization: async () => true },
        optIns: {
          isOptedIn: async ({ organizationId }) => {
            asked.push(organizationId);
            return organizationId === "organization";
          },
        },
      });

      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
      expect(asked).toEqual(["organization"]);
    });
  });
});

describe("given the flag is on for the project", () => {
  describe("when the project asks whether it may judge", () => {
    it("answers yes without reading the organization's switch", async () => {
      const access = InstantEvalAccessService.create({
        flags: { isEnabled: async () => true },
        projects: { findOrganizationId: async () => "organization" },
        isJudgeConfigured: () => true,
        optIns: {
          isOptedIn: () => {
            throw new Error("the gate read the organization's switch");
          },
        },
      });

      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
    });
  });
});

describe("given the flag is off for a project that belongs to no organization", () => {
  describe("when it asks whether it is released", () => {
    it("answers no, with no organization whose switch could say yes", async () => {
      const access = InstantEvalAccessService.create({
        flags: { isEnabled: async () => false },
        projects: { findOrganizationId: async () => undefined },
        isJudgeConfigured: () => true,
        optIns: {
          isOptedIn: () => {
            throw new Error("the gate read a switch for nobody");
          },
        },
      });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(false);
    });
  });
});
