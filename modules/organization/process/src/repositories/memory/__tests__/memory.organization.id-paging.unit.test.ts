import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");

function seeded(ids: readonly string[]) {
  const memory = MemoryOrganizationDatabase.create();
  for (const id of ids) {
    memory.organizations.set(id, {
      id,
      name: id,
      slug: id,
      supportContact: null,
      presenceEnabled: false,
      traceSharingEnabled: false,
      primaryIntent: null,
      s3Endpoint: null,
      s3AccessKeyId: null,
      s3SecretAccessKey: null,
      s3Bucket: null,
      stripeCustomerId: null,
      createdAt: created,
      updatedAt: created,
    });
  }
  return MemoryOrganizationRepository.create({ memory });
}

describe("MemoryOrganizationRepository id paging", () => {
  describe("given an install with three organizations", () => {
    /** @scenario "Reads every id when no limit is given" */
    it("reads all ids in id order and no next cursor when no limit is given", async () => {
      const repository = seeded(["org_c", "org_a", "org_b"]);

      expect(await repository.listAllIds()).toEqual({
        ids: ["org_a", "org_b", "org_c"],
        next: null,
      });
    });

    /** @scenario "Reads a page and the cursor that continues it" */
    it("reads a page and names its last id as the next cursor", async () => {
      const repository = seeded(["org_c", "org_a", "org_b"]);

      expect(await repository.listAllIds({ limit: 2 })).toEqual({
        ids: ["org_a", "org_b"],
        next: "org_b",
      });
    });

    /** @scenario "Continues after a cursor" */
    it("continues after the cursor and ends with a null next", async () => {
      const repository = seeded(["org_c", "org_a", "org_b"]);

      expect(await repository.listAllIds({ after: "org_b", limit: 2 })).toEqual({
        ids: ["org_c"],
        next: null,
      });
    });
  });

  describe("given an install with no organizations", () => {
    /** @scenario "An install with no organizations yields an empty page" */
    it("yields an empty page", async () => {
      expect(await seeded([]).listAllIds()).toEqual({ ids: [], next: null });
    });
  });
});
