/** Every model in the committed Prisma manifest must be accounted for. */

import { describe, expect, it } from "vitest";

import {
  derivePostgresCatalog,
  type PostgresDatasetOverride,
} from "../lwql-postgres-catalog-derivation.rules.ts";
import {
  assertPostgresSkipReasons,
  LWQL_POSTGRES_SKIPPED_MODELS,
  derivePostgresSkipReason,
} from "../lwql-postgres-skipped-models.rules.ts";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../lwql-postgres-view-catalog.rules.ts";
import { LWQL_PRISMA_MANIFEST } from "../lwql-prisma-manifest.rules.ts";
import type { PrismaManifest } from "../lwql-prisma-schema.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const NO_OVERRIDES: Record<string, PostgresDatasetOverride> = {};

const DERIVED_MODEL_COUNT = 87;
const SKIPPED_MODEL_COUNT = 70;

/**
 * Organization/admin-tier models the application reads only behind a distinct permission a
 * project's `analytics:view` key does not hold.
 */
const PERMISSION_GATED_MODELS = [
  "AuditLog",
  "WebhookEndpoint",
  "Subscription",
  "Invoice",
  "InvoiceItem",
  "BillingMeterCheckpoint",
  "IssuedLicense",
  "ActivationCode",
  "ConnectedBillingAccount",
  "SelfHostedInstance",
] as const;

const modelNames = LWQL_PRISMA_MANIFEST.models.map((model) => model.name);
const tableByModel = new Map(
  LWQL_PRISMA_MANIFEST.models.map((model) => [model.name, model.tableName]),
);

const derived = derivePostgresCatalog({
  manifest: LWQL_PRISMA_MANIFEST,
  skip: LWQL_POSTGRES_SKIPPED_MODELS,
  overrides: LWQL_POSTGRES_ALL_OVERRIDES,
});
const derivedBaseRelations = new Set(derived.map((view) => view.postgres!.baseRelation));

describe("given every model in the committed Prisma manifest", () => {
  it("is derived or skipped-with-a-reason — exactly once", () => {
    for (const model of modelNames) {
      const buckets = [
        derivedBaseRelations.has(tableByModel.get(model)!),
        derivePostgresSkipReason(model, LWQL_POSTGRES_SKIPPED_MODELS) !== undefined,
      ].filter(Boolean).length;
      expect(buckets, `"${model}" should land in exactly one bucket`).toBe(1);
    }
  });

  it("pins the current split with literal counts, so drift is visible", () => {
    const skipped = modelNames.filter(
      (model) => derivePostgresSkipReason(model, LWQL_POSTGRES_SKIPPED_MODELS) !== undefined,
    );
    expect(derived.length).toBe(DERIVED_MODEL_COUNT);
    expect(skipped.length).toBe(SKIPPED_MODEL_COUNT);
    expect(derived.length + skipped.length).toBe(modelNames.length);
  });

  it("never carries a stale skip entry", () => {
    for (const model of Object.keys(LWQL_POSTGRES_SKIPPED_MODELS)) {
      expect(
        modelNames,
        `skip entry "${model}" (${LWQL_POSTGRES_SKIPPED_MODELS[model]}) names no manifest model`,
      ).toContain(model);
    }
  });

  it("never derives an organization/admin-tier permission-gated model", () => {
    for (const model of PERMISSION_GATED_MODELS) {
      expect(
        derivedBaseRelations.has(tableByModel.get(model)!),
        `${model} is permission-gated and must not be a derived view`,
      ).toBe(false);
      expect(
        derivePostgresSkipReason(model, LWQL_POSTGRES_SKIPPED_MODELS),
        `${model} must be skipped with a permission-gated reason`,
      ).toContain("permission-gated:");
    }
  });

  it("never derives the identity scope User, Team or Organization", () => {
    for (const identity of ["User", "Team", "Organization"]) {
      expect(
        derivedBaseRelations.has(tableByModel.get(identity)!),
        `${identity} must not be derived`,
      ).toBe(false);
    }
  });

  it("carries every derived view in the merged LWQL_VIEW_CATALOG", () => {
    const merged = new Set(LWQL_VIEW_CATALOG.map((view) => view.name));
    for (const view of derived) {
      expect(
        merged.has(view.name),
        `"${view.name}" is derived but missing from LWQL_VIEW_CATALOG`,
      ).toBe(true);
    }
  });

  describe("when a new tenant-scoped model is neither derived, overridden nor skipped", () => {
    /** @scenario "A new tenant-scoped model that is neither derived, overridden nor skipped fails the build" */
    it("fails the build and names the model", () => {
      // The model carries a `tenantId` column — a tenant column, but the internal process-
      // manager/migration one the derivation refuses to treat as an owning project.
      const manifest: PrismaManifest = {
        models: [
          {
            name: "BrandNewThing",
            tableName: "BrandNewThing",
            documentation: "",
            primaryKey: ["id"],
            fields: [
              {
                name: "id",
                columnName: "id",
                type: "String",
                kind: "scalar",
                isList: false,
                isOptional: false,
                documentation: "",
              },
              {
                name: "tenantId",
                columnName: "tenantId",
                type: "String",
                kind: "scalar",
                isList: false,
                isOptional: false,
                documentation: "",
              },
            ],
          },
        ],
        enums: [],
      };
      let message = "";
      try {
        derivePostgresCatalog({
          manifest,
          skip: {},
          overrides: NO_OVERRIDES,
        });
      } catch (error) {
        message = error instanceof Error ? error.message : String(error);
      }
      expect(message).toContain("BrandNewThing");
      expect(message).toContain("owning tenant column");
      expect(message).toContain("catalogue it");
      expect(message).toContain("skip it");
    });
  });

  describe("when the skip list is validated", () => {
    /** @scenario "No model is left on the skip list with a TODO reason" */
    it("carries no TODO reason and every reason is category-prefixed", () => {
      expect(() => assertPostgresSkipReasons()).not.toThrow();
      for (const reason of Object.values(LWQL_POSTGRES_SKIPPED_MODELS)) {
        expect(reason).not.toContain("TODO");
      }
    });
  });
});
