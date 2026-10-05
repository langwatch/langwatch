/**
 * The offer and the switch, each peer stated rather than read.
 * @see specs/instant-evals/instant-eval-opt-in.feature
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
      await expect(optIns.optIn(asked)).resolves.toEqual({ released: true, offer: "enable" });
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
      });
      expect(recorded).toEqual([]);
    });
  });
});

describe("given a self-hosted install", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "A self-hosted install is offered a word with us" */
    it("offers a word with us without reading the plan", async () => {
      const { optIns } = service({
        isSaas: () => false,
        isEnterprisePlan: () => {
          throw new Error("the plan was read");
        },
      });
      await expect(optIns.getAccess(asked)).resolves.toMatchObject({ offer: "contact_us" });
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
