/**
 * The organization's own switch: who is offered it, and that the server
 * refuses it, recording nothing, wherever the popover offers "Contact us".
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { InstantEvalOptInNotOfferedError } from "@langwatch/instant-eval-contract";
import { ProjectNotFoundError } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import {
  type InstantEvalOptInPeers,
  InstantEvalOptInService,
} from "../instant-eval-opt-in.service.ts";

interface Recorded {
  optIns: { organizationId: string; userId: string }[];
  audits: { organizationId: string; userId: string; projectId: string }[];
  planReads: number;
  authorityReads: number;
}

function switchOver({
  isSaas = true,
  planType = "FREE",
  maySwitch = true,
  organizationId = "organization-1",
}: {
  isSaas?: boolean;
  planType?: string;
  maySwitch?: boolean;
  /** Null is a project with no organization behind it any more. */
  organizationId?: string | null;
} = {}) {
  const recorded: Recorded = { optIns: [], audits: [], planReads: 0, authorityReads: 0 };
  const peers: InstantEvalOptInPeers = {
    findOrganizationId: async () => organizationId ?? undefined,
    planTypeOf: async () => {
      recorded.planReads += 1;
      return planType;
    },
    maySwitch: async () => {
      recorded.authorityReads += 1;
      return maySwitch;
    },
    isOptedIn: async () => false,
    recordOptIn: async (input) => {
      recorded.optIns.push(input);
    },
    auditSwitch: async (input) => {
      recorded.audits.push(input);
    },
    isReleased: async () => false,
  };
  return { service: InstantEvalOptInService.create({ peers, isSaas: () => isSaas }), recorded };
}

const ASKER = { projectId: "project-1", userId: "user-1" };

describe("given a self-serve organization on the hosted service", () => {
  describe("when a member who may manage it asks what to offer", () => {
    /** @scenario "A self-serve organization is offered the switch" */
    it("offers the switch", async () => {
      const { service } = switchOver();

      await expect(service.readAccess(ASKER)).resolves.toEqual({
        released: false,
        offer: "enable",
      });
    });
  });

  describe("when a member who may not manage it asks what to offer", () => {
    /** @scenario "A member who may not throw the switch is told to ask an admin" */
    it("offers a word with an organization admin", async () => {
      const { service } = switchOver({ maySwitch: false });

      await expect(service.readAccess(ASKER)).resolves.toMatchObject({ offer: "ask_admin" });
    });
  });
});

describe("given an enterprise organization on the hosted service", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "An enterprise organization is offered a word with us" */
    it("offers a word with us, without asking what the member may do", async () => {
      const { service, recorded } = switchOver({ planType: "ENTERPRISE" });

      await expect(service.readAccess(ASKER)).resolves.toMatchObject({ offer: "contact_us" });
      expect(recorded.authorityReads).toBe(0);
    });
  });
});

describe("given a self-hosted install", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "A self-hosted install is offered a word with us" */
    it("offers a word with us without reading the plan", async () => {
      const { service, recorded } = switchOver({ isSaas: false });

      await expect(service.readAccess(ASKER)).resolves.toMatchObject({ offer: "contact_us" });
      expect(recorded.planReads).toBe(0);
    });
  });
});

describe("given an organization that is offered a word with us", () => {
  describe("when a request tries to throw the switch anyway", () => {
    /** @scenario "The server refuses a switch the popover did not offer" */
    it("is refused as not offered, and nothing is recorded", async () => {
      const { service, recorded } = switchOver({ planType: "ENTERPRISE" });

      await expect(service.switchOn(ASKER)).rejects.toBeInstanceOf(InstantEvalOptInNotOfferedError);
      expect(recorded.optIns).toEqual([]);
      expect(recorded.audits).toEqual([]);
    });
  });
});

describe("given a self-serve organization that has not switched Instant Evals on", () => {
  describe("when an admin throws the switch", () => {
    it("records the switch for the project's own organization and names it on the audit row", async () => {
      const { service, recorded } = switchOver();

      await expect(service.switchOn(ASKER)).resolves.toEqual({ released: true, offer: "enable" });
      expect(recorded.optIns).toEqual([{ organizationId: "organization-1", userId: "user-1" }]);
      expect(recorded.audits).toEqual([
        { organizationId: "organization-1", userId: "user-1", projectId: "project-1" },
      ]);
    });
  });
});

describe("given a project deleted after the permission check", () => {
  describe("when the switch resolves its organization", () => {
    it("is a handled not-found rather than an internal failure", async () => {
      const { service, recorded } = switchOver({ organizationId: null });

      await expect(service.switchOn(ASKER)).rejects.toBeInstanceOf(ProjectNotFoundError);
      expect(recorded.optIns).toEqual([]);
    });
  });
});
