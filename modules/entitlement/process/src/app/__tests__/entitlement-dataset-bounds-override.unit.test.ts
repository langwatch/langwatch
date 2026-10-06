import type { Plan } from "@langwatch/entitlement-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  DATASET_ATTACHMENT_DEFAULT_MAX_BYTES,
  DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES,
  DATASET_DEFAULT_BOUNDS,
  DATASET_DERIVED_BOUND_KEYS,
  deriveDatasetBounds,
  type RequestBoundsOverrides,
} from "@langwatch/plans";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { createEntitlementTestApp, fixedEntitlementSource } from "./entitlement.fixture.ts";

const MiB = 1024 * 1024;

const free: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 5,
  maxMembersLite: 5,
  maxMessagesPerMonth: 1_000,
  canPublish: false,
  prices: { USD: 0, EUR: 0 },
};

/** Organizations by the per-file limit an operator stored for each, in bytes. */
function organizationsWithLimits(limits: Record<string, number>) {
  const asked: string[] = [];
  const organizations = createApiFixture<OrganizationApi>({
    getDatasetLimits: async ({ organizationId }) => {
      asked.push(organizationId);
      return { attachmentMaxBytes: limits[organizationId] ?? null };
    },
  });

  return Object.assign(organizations, { asked });
}

function appWith(input: {
  limits: Record<string, number>;
  requestBounds?: RequestBoundsOverrides;
}) {
  const organizations = organizationsWithLimits(input.limits);
  const app = createEntitlementTestApp({
    infrastructure: { baseline: free, license: fixedEntitlementSource(null) },
    dependencies: { organizations },
    config: { requestBounds: input.requestBounds },
  });

  return { app, organizations };
}

describe("EntitlementModule.requestBound for the dataset size bounds", () => {
  describe("given an operator raised an organization's largest dataset file to 100 MB", () => {
    const limits = { "organization-raised": 100 * MiB };

    describe("when a module asks for that organization's dataset size bounds", () => {
      /** @scenario "An organization whose per-file limit was raised answers the raised dataset bounds" */
      it("answers 100 MB for the file and what 100 MB derives for every other bound", async () => {
        const { app } = appWith({ limits });
        const raised = deriveDatasetBounds(100 * MiB);

        await expect(
          app.requestBound({
            key: "datasetAttachmentBytes",
            organizationId: "organization-raised",
          }),
        ).resolves.toBe(100 * MiB);
        for (const key of DATASET_DERIVED_BOUND_KEYS) {
          await expect(
            app.requestBound({ key, organizationId: "organization-raised" }),
          ).resolves.toBe(raised[key]);
        }
        expect(raised.datasetRowBytes).toBeGreaterThan(DATASET_DEFAULT_BOUNDS.datasetRowBytes);
      });
    });

    describe("when a module asks for another organization's dataset size bounds", () => {
      /** @scenario "Raising one organization's per-file limit leaves every other organization on the defaults" */
      it("answers every default", async () => {
        const { app } = appWith({ limits });

        for (const key of DATASET_DERIVED_BOUND_KEYS) {
          await expect(
            app.requestBound({ key, organizationId: "organization-other" }),
          ).resolves.toBe(DATASET_DEFAULT_BOUNDS[key]);
        }
      });
    });

    describe("when a module asks for a bound that is not a dataset size bound", () => {
      /** @scenario "A raised per-file limit changes only the dataset size bounds" */
      it("answers the plan's bound without reading the organization's limit", async () => {
        const { app, organizations } = appWith({ limits });

        await expect(
          app.requestBound({ key: "tracesPageSizeMax", organizationId: "organization-raised" }),
        ).resolves.toBe(1_000);
        await expect(
          app.requestBound({ key: "datasetRowsMax", organizationId: "organization-raised" }),
        ).resolves.toBe(100_000);
        expect(organizations.asked).toEqual([]);
      });
    });
  });

  describe("given no operator set a largest dataset file for an organization", () => {
    describe("when a module asks for that organization's dataset size bounds", () => {
      /** @scenario "An organization with no override answers the default dataset bounds" */
      it("answers 20 MB for the file and every other default", async () => {
        const { app } = appWith({ limits: {} });

        await expect(
          app.requestBound({ key: "datasetAttachmentBytes", organizationId: "organization-1" }),
        ).resolves.toBe(20 * MiB);
        for (const key of DATASET_DERIVED_BOUND_KEYS) {
          await expect(app.requestBound({ key, organizationId: "organization-1" })).resolves.toBe(
            DATASET_DEFAULT_BOUNDS[key],
          );
        }
      });
    });
  });

  describe("given the deployment configures its own number for a dataset size bound", () => {
    describe("when a module asks for that bound", () => {
      /** @scenario "The larger of the deployment's bound and the organization's raised bound answers" */
      it("answers the larger number for a raised organization and the deployment's for the rest", async () => {
        const { app } = appWith({
          limits: { "organization-small": 50 * MiB, "organization-large": 500 * MiB },
          requestBounds: { datasetAttachmentBytes: 200 * MiB },
        });

        await expect(
          app.requestBound({ key: "datasetAttachmentBytes", organizationId: "organization-small" }),
        ).resolves.toBe(200 * MiB);
        await expect(
          app.requestBound({ key: "datasetAttachmentBytes", organizationId: "organization-large" }),
        ).resolves.toBe(500 * MiB);
        await expect(
          app.requestBound({ key: "datasetAttachmentBytes", organizationId: "organization-none" }),
        ).resolves.toBe(200 * MiB);
      });
    });
  });

  describe("given an organization's stored largest dataset file is outside the allowed range", () => {
    describe("when a module asks for that organization's largest dataset file", () => {
      /** @scenario "A stored per-file limit outside the allowed range is held to the range" */
      it("answers the default below it and the ceiling above it", async () => {
        const { app } = appWith({
          limits: { "organization-low": 1 * MiB, "organization-high": 4096 * MiB },
        });

        await expect(
          app.requestBound({ key: "datasetAttachmentBytes", organizationId: "organization-low" }),
        ).resolves.toBe(DATASET_ATTACHMENT_DEFAULT_MAX_BYTES);
        await expect(
          app.requestBound({ key: "datasetAttachmentBytes", organizationId: "organization-high" }),
        ).resolves.toBe(DATASET_ATTACHMENT_OVERRIDE_CEILING_BYTES);
      });
    });
  });
});
