import type { GuidedOnboardingRecord } from "@langwatch/onboarding-contract";
import { OrganizationNotFoundError } from "@langwatch/organization-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory/memory.organization.repository.ts";

/**
 * The guided-onboarding record lives in the organization's own sign-up
 * column, so a reload finds the welcome flow where it was left — and saving
 * it never erases the answers the sign-up form collected beside it.
 */

const ORGANIZATION_ID = "org-1";

let database: MemoryOrganizationDatabase;
let repository: MemoryOrganizationRepository;

function seedOrganization(signupData?: Record<string, unknown>): void {
  const now = new Date();
  database.organizations.set(ORGANIZATION_ID, {
    id: ORGANIZATION_ID,
    name: "Acme",
    slug: "acme",
    supportContact: null,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    ...(signupData ? { signupData } : {}),
    createdAt: now,
    updatedAt: now,
  });
}

beforeEach(() => {
  database = MemoryOrganizationDatabase.create();
  repository = MemoryOrganizationRepository.create({ memory: database });
});

describe("given an organization nobody has onboarded", () => {
  describe("when the record is read", () => {
    it("answers the empty state and no variant, rather than refusing", async () => {
      seedOrganization();

      expect(await repository.getGuidedOnboarding({ organizationId: ORGANIZATION_ID })).toEqual({
        state: { paths: [], donePaths: [] },
        variant: null,
      });
    });
  });
});

describe("given an organization whose sign-up answers are already stored", () => {
  describe("when guided onboarding is written", () => {
    it("keeps every other answer and replaces only the guided block", async () => {
      seedOrganization({
        usage: "production",
        solution: "observability",
        guidedOnboarding: { paths: ["billing"], donePaths: [] },
        onboardingVariant: "classic",
      });

      await repository.saveGuidedOnboarding({
        organizationId: ORGANIZATION_ID,
        record: {
          state: { paths: ["gateway", "llmops"], donePaths: ["gateway"], currentPath: "llmops" },
          variant: "guided",
        },
      });

      expect(database.organizations.get(ORGANIZATION_ID)?.signupData).toEqual({
        usage: "production",
        solution: "observability",
        guidedOnboarding: {
          paths: ["gateway", "llmops"],
          donePaths: ["gateway"],
          currentPath: "llmops",
        },
        onboardingVariant: "guided",
      });
    });

    it("reads back exactly what was written", async () => {
      seedOrganization({ usage: "production" });
      const record: GuidedOnboardingRecord = {
        state: { paths: ["coding"], donePaths: [], conversationId: "conv_1" },
        variant: "guided",
      };

      await repository.saveGuidedOnboarding({ organizationId: ORGANIZATION_ID, record });

      expect(await repository.getGuidedOnboarding({ organizationId: ORGANIZATION_ID })).toEqual(
        record,
      );
    });
  });

  describe("when the stored block is not the shape we wrote", () => {
    it("reads as the empty state, so a hand-edited row is not an error", async () => {
      seedOrganization({ guidedOnboarding: "not an object", onboardingVariant: "sideways" });

      expect(await repository.getGuidedOnboarding({ organizationId: ORGANIZATION_ID })).toEqual({
        state: { paths: [], donePaths: [] },
        variant: null,
      });
    });
  });
});

describe("given an organization that does not exist", () => {
  describe("when the record is read or written", () => {
    it("refuses by name rather than inventing an empty one", async () => {
      await expect(repository.getGuidedOnboarding({ organizationId: "nobody" })).rejects.toThrow(
        OrganizationNotFoundError,
      );
      await expect(
        repository.saveGuidedOnboarding({
          organizationId: "nobody",
          record: { state: { paths: [], donePaths: [] }, variant: null },
        }),
      ).rejects.toThrow(OrganizationNotFoundError);
    });
  });
});
