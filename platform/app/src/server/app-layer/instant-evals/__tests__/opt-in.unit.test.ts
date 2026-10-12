/**
 * The organization's own switch: what the popover offers, and that the first
 * click is the one that counts.
 *
 * @see ../opt-in.ts
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { InstantEvalOptInNotOfferedError } from "../errors";
import {
  enableInstantEvals,
  instantEvalOptInOffer,
  instantEvalSwitchOffered,
  selfHostedInstantEvalOffer,
  switchInstantEvalsOn,
} from "../opt-in";

/** A Prisma no path under test reaches: every row read here is injected. */
const NO_PRISMA = {} as PrismaClient;

describe("given a self-serve organization on the hosted service", () => {
  describe("when the switch path asks whether the organization is offered it", () => {
    /** @scenario "A self-serve organization is offered the switch" */
    it("says yes from the plan and the deployment alone", async () => {
      await expect(
        instantEvalSwitchOffered({
          organizationId: "organization",
          isSaas: () => true,
          planTypeOf: async () => "PRO",
        }),
      ).resolves.toBe(true);
    });
  });

  describe("when a member who may manage it asks what to offer", () => {
    /** @scenario "A self-serve organization is offered the switch" */
    it("offers the switch", async () => {
      await expect(
        instantEvalOptInOffer({
          prisma: NO_PRISMA,
          organizationId: "organization",
          maySwitch: async () => true,
          isSaas: () => true,
          planTypeOf: async () => "PRO",
        }),
      ).resolves.toBe("enable");
    });
  });

  describe("when a member who may not manage it asks what to offer", () => {
    /** @scenario "A member who may not throw the switch is told to ask an admin" */
    it("offers a word with an organization admin", async () => {
      await expect(
        instantEvalOptInOffer({
          prisma: NO_PRISMA,
          organizationId: "organization",
          maySwitch: async () => false,
          isSaas: () => true,
          planTypeOf: async () => "PRO",
        }),
      ).resolves.toBe("ask_admin");
    });
  });
});

describe("given an enterprise organization on the hosted service", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "An enterprise organization is offered a word with us" */
    it("offers a word with us, whatever the member may do", async () => {
      const maySwitch = vi.fn(async () => false);
      await expect(
        instantEvalOptInOffer({
          prisma: NO_PRISMA,
          organizationId: "organization",
          maySwitch,
          isSaas: () => true,
          planTypeOf: async () => "ENTERPRISE",
        }),
      ).resolves.toBe("contact_us");
      expect(maySwitch).not.toHaveBeenCalled();
    });
  });
});

describe("given a self-hosted install", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "A self-hosted install is told why from its judge and its license, and the plan is not read" */
    it("answers from the install's own reason, without reading the plan or the member", async () => {
      const planTypeOf = vi.fn(async () => "PRO");
      const maySwitch = vi.fn(async () => true);
      await expect(
        instantEvalOptInOffer({
          prisma: NO_PRISMA,
          organizationId: "organization",
          maySwitch,
          isSaas: () => false,
          planTypeOf,
          selfHostedOfferOf: async () => "not_in_license",
        }),
      ).resolves.toBe("not_in_license");
      expect(planTypeOf).not.toHaveBeenCalled();
      expect(maySwitch).not.toHaveBeenCalled();
    });
  });
});

describe("given a self-hosted install that is not released", () => {
  const licensed = { isEntitled: true, isSwitchedOn: true };
  const unlicensed = { isEntitled: false, isSwitchedOn: false };

  /** @scenario "A self-hosted install is told why from its judge and its license, and the plan is not read" */
  it.each([
    {
      reason:
        "judges through LangWatch on a license without Instant Evals, or no license",
      route: "connect",
      license: unlicensed,
      offer: "not_in_license",
    },
    {
      reason: "holds a license naming them that an admin switched off",
      route: "connect",
      license: { isEntitled: true, isSwitchedOn: false },
      offer: "switched_off",
    },
    {
      reason: "holds a license naming them but no credential to present",
      route: "connect",
      license: licensed,
      offer: "not_connected",
    },
    {
      reason: "has Connect switched off",
      route: "disconnected",
      license: licensed,
      offer: "not_connected",
    },
    {
      reason: "judges with its own key",
      route: "own_key",
      license: licensed,
      offer: "ask_operator",
    },
    {
      reason: "has judging turned off",
      route: "off",
      license: licensed,
      offer: "ask_operator",
    },
  ] as const)("is told so when it $reason", async ({
    route,
    license,
    offer,
  }) => {
    await expect(
      selfHostedInstantEvalOffer({
        prisma: NO_PRISMA,
        organizationId: "organization",
        judgeRoute: () => route,
        licenseOf: async () => license,
      }),
    ).resolves.toBe(offer);
  });

  it("never reads the license of an install that does not judge through LangWatch", async () => {
    const licenseOf = vi.fn(async () => licensed);
    await selfHostedInstantEvalOffer({
      prisma: NO_PRISMA,
      organizationId: "organization",
      judgeRoute: () => "own_key",
      licenseOf,
    });
    expect(licenseOf).not.toHaveBeenCalled();
  });
});

describe("given an organization that is offered a word with us", () => {
  describe("when a request tries to throw the switch anyway", () => {
    /** @scenario "The server refuses a switch the popover did not offer" */
    it("is refused as not offered, and nothing is recorded", async () => {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const prisma = {
        organization: { updateMany },
      } as unknown as PrismaClient;

      await expect(
        switchInstantEvalsOn({
          prisma,
          organizationId: "organization",
          userId: "member",
          isSaas: () => true,
          planTypeOf: async () => "ENTERPRISE",
        }),
      ).rejects.toMatchObject({
        name: "InstantEvalOptInNotOfferedError",
        meta: { deployment: "enterprise" },
      });
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("names the license, or the operator of an install with its own judge key, on a self-hosted install", async () => {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const prisma = {
        organization: { updateMany },
      } as unknown as PrismaClient;

      const refused = switchInstantEvalsOn({
        prisma,
        organizationId: "organization",
        userId: "member",
        isSaas: () => false,
      });
      await expect(refused).rejects.toBeInstanceOf(
        InstantEvalOptInNotOfferedError,
      );
      await expect(refused).rejects.toMatchObject({
        meta: { deployment: "self_hosted" },
        message: expect.stringContaining("from its license"),
      });
      await expect(refused).rejects.toMatchObject({
        message: expect.stringContaining(
          "from whoever runs it when it has its own judge key",
        ),
      });
      expect(updateMany).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that has not switched Instant Evals on", () => {
  describe("when a member throws the switch", () => {
    /** @scenario "Enable records the moment and the member, once" */
    it("records the moment and the member, only where no record exists yet", async () => {
      const updateMany = vi.fn(async () => ({ count: 1 }));
      const prisma = {
        organization: { updateMany },
      } as unknown as PrismaClient;
      const now = new Date("2026-09-29T12:00:00Z");

      await enableInstantEvals({
        prisma,
        organizationId: "organization",
        userId: "member",
        now: () => now,
      });

      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "organization", instantEvalsEnabledAt: null },
        data: {
          instantEvalsEnabledAt: now,
          instantEvalsEnabledByUserId: "member",
        },
      });
    });
  });
});
