/**
 * The organization's own switch: what the popover offers, and that the first
 * click is the one that counts.
 *
 * @see ../opt-in.ts
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */

import { describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { enableInstantEvals, instantEvalOptInOffer } from "../opt-in";

describe("given a self-serve organization on the hosted service", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "A self-serve organization is offered the switch" */
    it("offers the switch", async () => {
      await expect(
        instantEvalOptInOffer({
          organizationId: "organization",
          isSaas: () => true,
          planTypeOf: async () => "PRO",
        }),
      ).resolves.toBe("enable");
    });
  });
});

describe("given an enterprise organization on the hosted service", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "An enterprise organization is offered a word with us" */
    it("offers a word with us", async () => {
      await expect(
        instantEvalOptInOffer({
          organizationId: "organization",
          isSaas: () => true,
          planTypeOf: async () => "ENTERPRISE",
        }),
      ).resolves.toBe("contact_us");
    });
  });
});

describe("given a self-hosted install", () => {
  describe("when the popover asks what to offer", () => {
    /** @scenario "A self-hosted install is offered a word with us" */
    it("offers a word with us without reading the plan", async () => {
      const planTypeOf = vi.fn(async () => "PRO");
      await expect(
        instantEvalOptInOffer({
          organizationId: "organization",
          isSaas: () => false,
          planTypeOf,
        }),
      ).resolves.toBe("contact_us");
      expect(planTypeOf).not.toHaveBeenCalled();
    });
  });
});

describe("given an organization that has not switched Instant Evals on", () => {
  describe("when a member throws the switch", () => {
    /** @scenario "Enable switches the organization on and the judgement goes ahead" */
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
