import {
  ARD_REGISTRY_ADAPTER_ID,
  AWS_BEDROCK_AGENTS_ADAPTER_ID,
  GovernanceValidationError,
} from "@langwatch/enterprise-governance-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { PullDestinationService } from "../../features/ingestion-pull/services/pull-destination.service.ts";
import { IngestionSourceValidationService } from "../../features/ingestion-source/services/ingestion-source-validation.service.ts";

const validation = IngestionSourceValidationService.create({
  projects: createApiFixture<ProjectApi>({}, "ProjectApi"),
});

function refusalOf(save: () => void): GovernanceValidationError {
  try {
    save();
  } catch (error) {
    if (error instanceof GovernanceValidationError) return error;
    throw error;
  }
  throw new Error("the save was not refused");
}

describe("given an AWS source with a bad region and no connection", () => {
  describe("when an admin saves it", () => {
    /** @scenario "An AWS source needs a connection and at least one valid region" */
    it("refuses with field errors on the regions and the connection", () => {
      const refusal = refusalOf(() =>
        validation.assertPullConfig({
          adapter: AWS_BEDROCK_AGENTS_ADAPTER_ID,
          regions: ["not-a-region"],
        }),
      );

      expect(refusal.code).toBe("validation_error");
      expect(Object.keys(refusal.meta.fieldErrors ?? {}).toSorted()).toEqual([
        "awsConnectionId",
        "regions",
      ]);
    });
  });

  describe("when the connection and the region are both valid", () => {
    it("saves", () => {
      expect(() =>
        validation.assertPullConfig({
          adapter: AWS_BEDROCK_AGENTS_ADAPTER_ID,
          awsConnectionId: "awsconn_1",
          regions: ["eu-west-1", "us-gov-west-1"],
        }),
      ).not.toThrow();
    });
  });
});

describe("given an ARD source pointing at the cloud metadata address", () => {
  describe("when an admin saves it", () => {
    /** @scenario "An ARD source address that points inside the network is refused" */
    it("is refused by the outbound address fence", async () => {
      await expect(
        PullDestinationService.create().assertListingAddressesAllowed({
          adapter: ARD_REGISTRY_ADAPTER_ID,
          registryUrl: "http://169.254.169.254",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });

    it("refuses a search endpoint inside the network too", async () => {
      await expect(
        PullDestinationService.create().assertListingAddressesAllowed({
          adapter: ARD_REGISTRY_ADAPTER_ID,
          registryUrl: "registry.acme.test",
          searchUrl: "http://169.254.169.254/search",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });
  });

  describe("when the registry is a public address", () => {
    it("saves", async () => {
      await expect(
        PullDestinationService.create().assertListingAddressesAllowed({
          adapter: ARD_REGISTRY_ADAPTER_ID,
          registryUrl: "https://registry.acme.test",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
