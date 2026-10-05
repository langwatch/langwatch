/**
 * The organization's Instant Evals consent: the first member's moment and id
 * are the ones that count, so a second click keeps them.
 * @see specs/instant-evals/instant-eval-opt-in.feature
 */
import { fromDate, nowInstant } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory/memory.organization.repository.ts";

const ORGANIZATION_ID = "org-1";
const FIRST = { userId: "first-member", at: fromDate(new Date("2026-09-29T12:00:00Z")) };
const SECOND = { userId: "second-member", at: fromDate(new Date("2026-09-30T12:00:00Z")) };

let database: MemoryOrganizationDatabase;
let repository: MemoryOrganizationRepository;

beforeEach(() => {
  database = MemoryOrganizationDatabase.create();
  repository = MemoryOrganizationRepository.create({ memory: database });
  const now = nowInstant();
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
    createdAt: now,
    updatedAt: now,
  });
});

describe("given an organization that has not switched Instant Evals on", () => {
  it("reads as not opted in", async () => {
    await expect(
      repository.isInstantEvalsOptedIn({ organizationId: ORGANIZATION_ID }),
    ).resolves.toBe(false);
  });

  describe("when a member throws the switch, and another later", () => {
    /** @scenario "Enable records the moment and the member, once" */
    it("records the first member's moment and id, and keeps them", async () => {
      await repository.recordInstantEvalsOptIn({ organizationId: ORGANIZATION_ID, ...FIRST });
      await repository.recordInstantEvalsOptIn({ organizationId: ORGANIZATION_ID, ...SECOND });

      const stored = database.organizations.get(ORGANIZATION_ID);
      expect(stored?.instantEvalsEnabledAt).toEqual(FIRST.at);
      expect(stored?.instantEvalsEnabledByUserId).toBe(FIRST.userId);
      await expect(
        repository.isInstantEvalsOptedIn({ organizationId: ORGANIZATION_ID }),
      ).resolves.toBe(true);
    });
  });
});

describe("given an organization that does not exist", () => {
  it("reads as never opted in", async () => {
    await expect(repository.isInstantEvalsOptedIn({ organizationId: "missing" })).resolves.toBe(
      false,
    );
  });
});
