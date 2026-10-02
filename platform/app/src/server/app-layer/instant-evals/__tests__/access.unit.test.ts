/**
 * The gate: two conditions, and the one that costs nothing is checked first.
 *
 * Both tests state the deployment's configuration rather than reading it, so
 * the answers here do not change with whatever the ambient environment has set
 * `INSTANT_EVAL_CLASSIFIER` to.
 *
 * @see ../access.ts
 * @see specs/lwql/eval-functions.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import {
  instantEvalsEnabled,
  instantEvalsReleased,
  organizationOfProject,
} from "../access";

const flag = vi.hoisted(() => ({ isEnabled: vi.fn(async () => false) }));
vi.mock("~/server/featureFlag", () => ({ featureFlagService: flag }));

/** A Prisma that fails loudly, so a reach for it is observable either way. */
const REACHED = "the gate read the project";
const LOUD_PRISMA = {
  project: {
    findUnique: () => {
      throw new Error(REACHED);
    },
  },
} as unknown as PrismaClient;

describe("given a deployment with no classifier configured", () => {
  describe("when a project asks whether it may judge", () => {
    /** @scenario "An eval function is refused when the deployment has no classifier" */
    it("answers no without resolving the flag or reading the project", async () => {
      await expect(
        instantEvalsEnabled({
          prisma: LOUD_PRISMA,
          projectId: "project-without-a-classifier",
          isClassifierConfigured: () => false,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given a deployment with a classifier configured", () => {
  describe("when a project asks whether it may judge", () => {
    it("goes on to the flag, which needs the project's organization", async () => {
      // The operational condition passing is what lets the product decision be
      // asked at all, and that decision needs the organization the project
      // belongs to. Asserting the read happens is what pins the order: were
      // the two swapped, a deployment with nothing to answer with would still
      // pay for a project read on every query.
      await expect(
        instantEvalsEnabled({
          prisma: LOUD_PRISMA,
          projectId: "project-with-a-classifier",
          isClassifierConfigured: () => true,
        }),
      ).rejects.toThrow(REACHED);
    });
  });
});

/** A Prisma that answers the one read the gate makes, with an organization. */
const QUIET_PRISMA = {
  project: {
    findUnique: async () => ({ team: { organizationId: "organization" } }),
  },
} as unknown as PrismaClient;

beforeEach(() => {
  flag.isEnabled.mockClear();
  flag.isEnabled.mockResolvedValue(false);
});

describe("given the flag is off and the organization switched Instant Evals on itself", () => {
  describe("when a project of that organization asks whether it may judge", () => {
    /** @scenario "An organization that switched itself on is judged without the flag" */
    it("answers yes from the organization's switch", async () => {
      const isOptedIn = vi.fn(async (organizationId: string) => {
        return organizationId === "organization";
      });
      await expect(
        instantEvalsEnabled({
          prisma: QUIET_PRISMA,
          projectId: "project-of-an-opted-in-organization",
          isClassifierConfigured: () => true,
          isClassifierAvailableForOrganization: async () => true,
          isLicensed: async () => false,
          isOptedIn,
        }),
      ).resolves.toBe(true);
      expect(isOptedIn).toHaveBeenCalledWith("organization");
    });
  });
});

describe("given the flag is off on a self-hosted install that judges through LangWatch", () => {
  describe("when the organization's license names Instant Evals and no admin switched them off", () => {
    /** @scenario "A license that names Instant Evals releases them without the flag" */
    it("answers yes from the license, without reading the organization's own switch", async () => {
      const isOptedIn = vi.fn(async () => false);
      await expect(
        instantEvalsReleased({
          prisma: QUIET_PRISMA,
          projectId: "project-of-a-licensed-organization",
          isLicensed: async (organizationId) =>
            organizationId === "organization",
          isOptedIn,
        }),
      ).resolves.toBe(true);
      expect(isOptedIn).not.toHaveBeenCalled();
    });
  });

  describe("when an admin switched hosted judging off", () => {
    /** @scenario "An admin who switched hosted judging off keeps it off" */
    it("answers no, from the license and the switch alike", async () => {
      // The license read is false here because `isAvailableForOrganization`
      // is: the Connect classifier reads the admin's switch-off as off.
      await expect(
        instantEvalsEnabled({
          prisma: QUIET_PRISMA,
          projectId: "project-of-a-switched-off-organization",
          isClassifierConfigured: () => true,
          isClassifierAvailableForOrganization: async () => false,
          isLicensed: async () => {
            throw new Error("an unavailable classifier never asks the license");
          },
          isOptedIn: async () => false,
        }),
      ).resolves.toBe(false);
      await expect(
        instantEvalsReleased({
          prisma: QUIET_PRISMA,
          projectId: "project-of-a-switched-off-organization",
          isLicensed: async () => false,
          isOptedIn: async () => false,
        }),
      ).resolves.toBe(false);
    });
  });
});

describe("given the flag is on for the project on a licensed install", () => {
  describe("when the project asks whether it is released", () => {
    it("answers yes without reading the license", async () => {
      flag.isEnabled.mockResolvedValue(true);
      const isLicensed = vi.fn(async () => true);
      await expect(
        instantEvalsReleased({
          prisma: QUIET_PRISMA,
          projectId: "project-the-operator-released",
          isLicensed,
        }),
      ).resolves.toBe(true);
      expect(isLicensed).not.toHaveBeenCalled();
    });
  });
});

describe("given the flag is on for the project", () => {
  describe("when the project asks whether it may judge", () => {
    it("answers yes without reading the organization's switch", async () => {
      flag.isEnabled.mockResolvedValue(true);
      const isOptedIn = vi.fn(async () => false);
      await expect(
        instantEvalsEnabled({
          prisma: QUIET_PRISMA,
          projectId: "project-the-operator-released",
          isClassifierConfigured: () => true,
          isClassifierAvailableForOrganization: async () => true,
          isLicensed: async () => false,
          isOptedIn,
        }),
      ).resolves.toBe(true);
      expect(isOptedIn).not.toHaveBeenCalled();
    });
  });
});

describe("given a project with no organization behind it", () => {
  describe("when a router resolves the organization it may not take from its input", () => {
    it("throws a handled not-found rather than answering for nobody", async () => {
      const prisma = {
        project: { findUnique: async () => null },
      } as unknown as PrismaClient;
      await expect(
        organizationOfProject({ prisma, projectId: "gone" }),
      ).rejects.toMatchObject({
        name: "NotFoundError",
        code: "project_not_found",
        httpStatus: 404,
      });
    });
  });
});

describe("given a classifier that judges for some organizations only", () => {
  describe("when a project of an organization it does not judge for asks", () => {
    /** @scenario "An install with the service off publishes eval functions as unavailable" */
    it("answers no without resolving the flag", async () => {
      await expect(
        instantEvalsEnabled({
          prisma: QUIET_PRISMA,
          projectId: "project-of-an-organization-that-did-not-opt-in",
          isClassifierConfigured: () => true,
          isClassifierAvailableForOrganization: async () => false,
        }),
      ).resolves.toBe(false);
    });
  });
});
