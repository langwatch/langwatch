/**
 * The offer and the switch, each peer stated rather than read.
 * @see modules/instant-eval/specs/instant-eval-opt-in.feature
 */

import { describe, expect, it } from "vitest";

import {
  type InstantEvalOptInPeers,
  InstantEvalOptInService,
} from "../instant-eval-opt-in.service.ts";

function service(overrides: Partial<InstantEvalOptInPeers> = {}) {
  const recorded: { organizationId: string; userId: string }[] = [];
  const peers: InstantEvalOptInPeers = {
    findOrganizationId: async () => "organization-1",
    isSaas: () => true,
    judgeRoute: async () => "own_key",
    licenseStateOf: async () => ({ isEntitled: false, isSwitchedOn: false }),
    isEnterprisePlan: async () => false,
    mayManageOrganization: async () => true,
    isReleased: async () => false,
    recordOptIn: async (input) => {
      recorded.push(input);
    },
    ...overrides,
  };
  return { optIns: InstantEvalOptInService.create({ peers }), recorded };
}

const asked = { projectId: "project-1", userId: "user-1" };

describe("given an organization on the hosted service that is not on an enterprise plan", () => {
  describe("when the popover asks what to offer a member who may manage the organization", () => {
    /** @scenario "A self-serve organization is offered the switch" */
    it("offers the switch", async () => {
      await expect(service().optIns.getAccess(asked)).resolves.toEqual({
        released: false,
        offer: "enable",
        viaConnect: false,
      });
    });
  });

  describe("when the popover asks what to offer a member who may not", () => {
    /** @scenario "A member who may not throw the switch is told to ask an admin" */
    it("offers a word with an organization admin", async () => {
      const { optIns } = service({ mayManageOrganization: async () => false });
      await expect(optIns.getAccess(asked)).resolves.toMatchObject({ offer: "ask_admin" });
    });
  });

  describe("when a member throws the switch", () => {
    /** @scenario "Enable records the moment and the member, once" */
    it("records the member against the project's organization", async () => {
      const { optIns, recorded } = service();
      await expect(optIns.optIn(asked)).resolves.toEqual({
        released: true,
        offer: "enable",
        viaConnect: false,
      });
      expect(recorded).toEqual([{ organizationId: "organization-1", userId: "user-1" }]);
    });
  });
});

describe("given an organization on an enterprise plan", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "An enterprise organization is offered a word with us" */
    it("offers a word with us, whatever the member may do", async () => {
      const { optIns } = service({
        isEnterprisePlan: async () => true,
        mayManageOrganization: () => {
          throw new Error("the member was asked");
        },
      });
      await expect(optIns.getAccess(asked)).resolves.toMatchObject({ offer: "contact_us" });
    });
  });

  describe("when a request tries to throw the switch anyway", () => {
    /** @scenario "The server refuses a switch the popover did not offer" */
    it("refuses it as not offered and records nothing", async () => {
      const { optIns, recorded } = service({ isEnterprisePlan: async () => true });
      await expect(optIns.optIn(asked)).rejects.toMatchObject({
        code: "instant_eval_opt_in_not_offered",
        meta: { deployment: "enterprise" },
        message:
          "LangWatch switches Instant Evals on for an enterprise plan. Contact us to get them.",
      });
      expect(recorded).toEqual([]);
    });
  });
});

describe("given a self-hosted install", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "A self-hosted install is told why from its judge and its license, and the plan is not read" */
    it("names its license, its admin's switch, its connection or its operator", async () => {
      const offerOf = async (peers: Partial<InstantEvalOptInPeers>) => {
        const { optIns } = service({
          isSaas: () => false,
          judgeRoute: async () => "connect",
          isEnterprisePlan: () => {
            throw new Error("the plan was read");
          },
          ...peers,
        });
        return (await optIns.getAccess(asked)).offer;
      };
      const license = (isEntitled: boolean, isSwitchedOn: boolean) => ({
        licenseStateOf: async () => ({ isEntitled, isSwitchedOn }),
      });

      expect(await offerOf(license(false, false))).toBe("not_in_license");
      expect(await offerOf(license(true, false))).toBe("switched_off");
      expect(await offerOf(license(true, true))).toBe("not_connected");
      expect(await offerOf({ judgeRoute: async () => "disconnected" })).toBe("not_connected");
      expect(await offerOf({ judgeRoute: async () => "own_key" })).toBe("ask_operator");
      expect(await offerOf({ judgeRoute: async () => "off" })).toBe("ask_operator");
    });
  });

  describe("when a request tries to throw the switch anyway", () => {
    /** @scenario "The server refuses a switch the popover did not offer" */
    it("refuses it naming the license, or whoever runs an install with its own key", async () => {
      const { optIns, recorded } = service({ isSaas: () => false });
      await expect(optIns.optIn(asked)).rejects.toMatchObject({
        code: "instant_eval_opt_in_not_offered",
        meta: { deployment: "self_hosted" },
        message:
          "A self-hosted install gets Instant Evals from its license, or from whoever runs it when it has its own judge key, never from this switch. Contact us to add them to your license.",
      });
      expect(recorded).toEqual([]);
    });
  });

  describe("when the access read asks whether the install judges through LangWatch", () => {
    /** @scenario "A judgement that fails on an install judging through LangWatch names the addresses it needs" */
    it("says so only where its judge runs through Connect", async () => {
      const through = service({ isSaas: () => false, judgeRoute: async () => "connect" });
      await expect(through.optIns.getAccess(asked)).resolves.toMatchObject({ viaConnect: true });
      for (const route of ["off", "own_key", "disconnected"] as const) {
        const other = service({ isSaas: () => false, judgeRoute: async () => route });
        await expect(other.optIns.getAccess(asked)).resolves.toMatchObject({ viaConnect: false });
      }
    });
  });
});

describe("given the hosted service", () => {
  describe("when the access read asks whether it judges through LangWatch", () => {
    it("answers no without asking where its judge runs", async () => {
      const { optIns } = service({
        judgeRoute: () => {
          throw new Error("the judge route was read");
        },
      });
      await expect(optIns.getAccess(asked)).resolves.toMatchObject({ viaConnect: false });
    });
  });
});

describe("given a project deleted between the permission check and the read", () => {
  describe("when the popover asks what to offer", () => {
    it("refuses with the handled project not-found", async () => {
      const { optIns } = service({ findOrganizationId: async () => undefined });
      await expect(optIns.getAccess(asked)).rejects.toMatchObject({ code: "project_not_found" });
    });
  });
});
