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
  type InstantEvalPlanReader,
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

const NEVER_OPTED_IN: InstantEvalOptInReader = { isOptedIn: async () => false };

function gate({
  isJudgeConfigured,
  flags = LOUD_FLAGS,
  projects = LOUD_PROJECTS,
  optIns = NEVER_OPTED_IN,
  hostedPlans,
}: {
  isJudgeConfigured: () => boolean;
  flags?: InstantEvalFlagReader;
  projects?: InstantEvalProjectReader;
  optIns?: InstantEvalOptInReader;
  hostedPlans: InstantEvalPlanReader | null;
}) {
  return InstantEvalAccessService.create({
    flags,
    projects,
    optIns,
    isJudgeConfigured,
    hostedPlans,
  });
}

describe("given a deployment with no judge configured", () => {
  describe("when a project asks whether it may judge", () => {
    /** @scenario "An eval function is refused when the deployment has no classifier" */
    it("answers no without resolving the flag or reading the project", async () => {
      await expect(
        gate({ isJudgeConfigured: () => false, hostedPlans: null }).isEnabled({
          projectId: "project-1",
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given a deployment with a judge configured", () => {
  describe("when a project asks whether it may judge", () => {
    it("goes on to the flag, which needs the project's organization", async () => {
      await expect(
        gate({ isJudgeConfigured: () => true, hostedPlans: null }).isEnabled({
          projectId: "project-1",
        }),
      ).rejects.toThrow(REACHED);
    });

    it("asks the flag for the project, carrying the organization it belongs to", async () => {
      const asked: { flagKey: string; target: Record<string, unknown> }[] = [];
      const enabled = await gate({
        isJudgeConfigured: () => true,
        hostedPlans: null,
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
        hostedPlans: null,
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
        hostedPlans: null,
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
        optIns: NEVER_OPTED_IN,
        isJudgeConfigured: () => true,
        hostedPlans: null,
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
        optIns: NEVER_OPTED_IN,
        isJudgeConfigured: () => true,
        hostedPlans: null,
        judge: { isAvailableForOrganization: async () => true },
      });

      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
    });
  });
});

describe("given a self-serve organization on the hosted service", () => {
  const selfServe: InstantEvalPlanReader = { isEnterprisePlan: async () => false };
  const inOrganization: InstantEvalProjectReader = {
    findOrganizationId: async () => "organization-1",
  };

  describe("when it switched Instant Evals on and the release flag is off", () => {
    /** @scenario "An organization that switched itself on is judged without the flag" */
    it("may judge, from the organization's switch", async () => {
      const asked: string[] = [];
      const released = await gate({
        isJudgeConfigured: () => true,
        flags: { isEnabled: async () => false },
        projects: inOrganization,
        hostedPlans: selfServe,
        optIns: {
          isOptedIn: async (organizationId) => {
            asked.push(organizationId);
            return true;
          },
        },
      }).isEnabled({ projectId: "project-1" });

      expect(released).toBe(true);
      expect(asked).toEqual(["organization-1"]);
    });
  });

  describe("when it has not switched Instant Evals on and the release flag is on", () => {
    /** @scenario "The release flag does not release a self-serve organization that never switched itself on" */
    it("may not judge, and the flag is not read", async () => {
      const access = gate({
        isJudgeConfigured: () => true,
        projects: inOrganization,
        hostedPlans: selfServe,
      });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(false);
      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(false);
    });
  });

  describe("when its project belongs to no organization", () => {
    it("may not judge, with no plan to read", async () => {
      await expect(
        gate({
          isJudgeConfigured: () => true,
          projects: { findOrganizationId: async () => undefined },
          hostedPlans: {
            isEnterprisePlan: () => {
              throw new Error("the gate read the plan");
            },
          },
        }).isReleased({ projectId: "project-1" }),
      ).resolves.toBe(false);
    });
  });
});

describe("given an enterprise organization on the hosted service", () => {
  const enterprise: InstantEvalPlanReader = { isEnterprisePlan: async () => true };
  const inOrganization: InstantEvalProjectReader = {
    findOrganizationId: async () => "organization-1",
  };
  const LOUD_OPT_INS: InstantEvalOptInReader = {
    isOptedIn: () => {
      throw new Error("the gate read the switch");
    },
  };

  describe("when the release flag is on for the project", () => {
    /** @scenario "The release flag releases an enterprise organization" */
    it("may judge, without reading the organization's switch", async () => {
      await expect(
        gate({
          isJudgeConfigured: () => true,
          flags: { isEnabled: async () => true },
          projects: inOrganization,
          hostedPlans: enterprise,
          optIns: LOUD_OPT_INS,
        }).isReleased({ projectId: "project-1" }),
      ).resolves.toBe(true);
    });
  });

  describe("when the release flag is off and its switch was thrown earlier", () => {
    /** @scenario "A switch thrown before an organization moved to an enterprise plan no longer counts" */
    it("may not judge", async () => {
      await expect(
        gate({
          isJudgeConfigured: () => true,
          flags: { isEnabled: async () => false },
          projects: inOrganization,
          hostedPlans: enterprise,
          optIns: LOUD_OPT_INS,
        }).isReleased({ projectId: "project-1" }),
      ).resolves.toBe(false);
    });
  });
});

describe("given an install off the hosted service, with the release flag on", () => {
  describe("when the project asks whether it is released", () => {
    it("may judge from the flag, without reading the organization's switch", async () => {
      await expect(
        gate({
          isJudgeConfigured: () => true,
          flags: { isEnabled: async () => true },
          projects: { findOrganizationId: async () => "organization-1" },
          hostedPlans: null,
          optIns: {
            isOptedIn: () => {
              throw new Error("the gate read the switch");
            },
          },
        }).isReleased({ projectId: "project-1" }),
      ).resolves.toBe(true);
    });
  });
});

describe("given a self-hosted install that judges through LangWatch, with the release flag off", () => {
  const flagOff: InstantEvalFlagReader = { isEnabled: async () => false };
  const projects: InstantEvalProjectReader = { findOrganizationId: async () => "organization-1" };
  const LOUD_OPT_INS: InstantEvalOptInReader = {
    isOptedIn: () => {
      throw new Error("the gate read the switch");
    },
  };

  describe("when the organization's license names Instant Evals and no admin switched them off", () => {
    /** @scenario "A license that names Instant Evals releases them without the flag" */
    it("may judge, from the license, without reading the organization's switch", async () => {
      const access = InstantEvalAccessService.create({
        flags: flagOff,
        projects,
        judgesThroughConnect: true,
        optIns: LOUD_OPT_INS,
        isJudgeConfigured: () => true,
        hostedPlans: null,
        judge: { isAvailableForOrganization: async () => true },
      });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(true);
      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(true);
    });
  });

  describe("when the license does not name them and the release flag is on", () => {
    /** @scenario "The release flag does not release a self-hosted install without a license" */
    it("may not judge, without reading the flag or the organization's switch", async () => {
      const access = InstantEvalAccessService.create({
        flags: LOUD_FLAGS,
        projects,
        judgesThroughConnect: true,
        optIns: LOUD_OPT_INS,
        isJudgeConfigured: () => true,
        hostedPlans: null,
        judge: { isAvailableForOrganization: async () => false },
      });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(false);
      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(false);
    });
  });

  describe("when the license names them but an admin switched them off", () => {
    /** @scenario "An admin who switched hosted judging off keeps it off" */
    it("may not judge", async () => {
      const access = InstantEvalAccessService.create({
        flags: flagOff,
        projects,
        judgesThroughConnect: true,
        optIns: NEVER_OPTED_IN,
        isJudgeConfigured: () => true,
        hostedPlans: null,
        judge: { isAvailableForOrganization: async () => false },
      });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(false);
      await expect(access.isEnabled({ projectId: "project-1" })).resolves.toBe(false);
    });
  });
});

/** A development checkout with no classifier: it judges, but not through LangWatch. */
function devCheckout({ flagOn }: { flagOn: boolean }) {
  return InstantEvalAccessService.create({
    flags: { isEnabled: async () => flagOn },
    projects: { findOrganizationId: async () => "organization-1" },
    judgesThroughConnect: false,
    optIns: NEVER_OPTED_IN,
    isJudgeConfigured: () => true,
    hostedPlans: null,
    judge: {
      isAvailableForOrganization: () => {
        throw new Error("the gate read the license");
      },
    },
  });
}

describe("given a development checkout", () => {
  describe("when the project asks whether it may judge", () => {
    /** @scenario "A development checkout waits for the release flag" */
    it("is released with the flag on, and the license is not read", async () => {
      const access = devCheckout({ flagOn: true });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(true);
    });

    /** @scenario "A development checkout waits for the release flag" */
    it("is not released with the flag off, and the license is not read", async () => {
      const access = devCheckout({ flagOn: false });

      await expect(access.isReleased({ projectId: "project-1" })).resolves.toBe(false);
    });
  });
});
