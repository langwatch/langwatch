import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const created = Temporal.Instant.from("2026-09-01T00:00:00Z");

function seeded(organizations: Record<string, number | null>) {
  const memory = MemoryOrganizationDatabase.create();
  for (const [id, datasetAttachmentMaxMb] of Object.entries(organizations)) {
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
      datasetAttachmentMaxMb,
      createdAt: created,
      updatedAt: created,
    });
  }
  return MemoryOrganizationRepository.create({ memory });
}

describe("MemoryOrganizationRepository dataset limits read", () => {
  describe("given a memory organization whose largest dataset file is 100 MB", () => {
    describe("when the organization's dataset limits are read", () => {
      /** @scenario "The memory organization store answers the per-file dataset limit the same way" */
      it("answers the limit in bytes, and none where nothing is stored", async () => {
        const repository = seeded({ org_raised: 100, org_default: null });

        expect(await repository.getDatasetLimits({ organizationId: "org_raised" })).toEqual({
          attachmentMaxBytes: 104_857_600,
        });
        expect(await repository.getDatasetLimits({ organizationId: "org_default" })).toEqual({
          attachmentMaxBytes: null,
        });
        expect(await repository.getDatasetLimits({ organizationId: "org_none" })).toEqual({
          attachmentMaxBytes: null,
        });
      });
    });
  });
});
