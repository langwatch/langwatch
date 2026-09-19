/**
 * Every model in the committed Prisma manifest must be accounted for.
 *
 * The Postgres catalog's opt-out design
 * ({@link ../derivePostgresCatalog#derivePostgresCatalog}) only holds if the
 * accounting is exhaustive and non-overlapping: a model is exactly one of
 * derived (a view whose `baseRelation` is the model's table) or
 * skipped-with-a-reason (a key in {@link LWQL_POSTGRES_SKIPPED_MODELS}). This
 * guards that invariant directly against the manifest and pins the split with
 * literal counts, so a model quietly moving between buckets — or a new
 * tenant-scoped table falling off the catalog — shows up as a failing
 * assertion rather than a silent change in `derived.length`.
 *
 * The mirror of `./tenantTableCoverage.unit.test.ts` for the ClickHouse half.
 */

import { describe, expect, it } from "vitest";

import {
  derivePostgresCatalog,
  type PostgresDatasetOverride,
} from "../derivePostgresCatalog";
import { LWQL_VIEW_CATALOG } from "../lwqlViews";
import {
  assertPostgresSkipReasons,
  LWQL_POSTGRES_SKIPPED_MODELS,
  postgresSkipReason,
} from "../postgresSkippedModels";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../postgresViews";
import { LWQL_PRISMA_MANIFEST } from "../prismaManifest";
import type { PrismaManifest } from "../prismaSchema";

const DERIVED_MODEL_COUNT = 93;
const SKIPPED_MODEL_COUNT = 37;

const modelNames = LWQL_PRISMA_MANIFEST.models.map((model) => model.name);
const tableByModel = new Map(
  LWQL_PRISMA_MANIFEST.models.map((model) => [model.name, model.tableName]),
);

const derived = derivePostgresCatalog({
  manifest: LWQL_PRISMA_MANIFEST,
  skip: LWQL_POSTGRES_SKIPPED_MODELS,
  overrides: LWQL_POSTGRES_ALL_OVERRIDES,
});
const derivedBaseRelations = new Set(
  derived.map((view) => view.postgres!.baseRelation),
);

describe("given every model in the committed Prisma manifest", () => {
  it("is derived or skipped-with-a-reason — exactly once", () => {
    for (const model of modelNames) {
      const buckets = [
        derivedBaseRelations.has(tableByModel.get(model)!),
        postgresSkipReason(model, LWQL_POSTGRES_SKIPPED_MODELS) !== undefined,
      ].filter(Boolean).length;
      expect(buckets, `"${model}" should land in exactly one bucket`).toBe(1);
    }
  });

  it("pins the current split with literal counts, so drift is visible", () => {
    const skipped = modelNames.filter(
      (model) =>
        postgresSkipReason(model, LWQL_POSTGRES_SKIPPED_MODELS) !== undefined,
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
      // The model carries a `tenantId` column — a tenant column, but the
      // internal process-manager/migration one the derivation refuses to treat
      // as an owning project. So it is genuinely tenant-scoped (the scenario's
      // "a tenant column that no view, override or skip entry names") yet has no
      // *owning* tenant column, exercising the coverage failure rather than the
      // plain no-column one. (A `projectId` column would silently auto-derive,
      // which is the opt-out contract, so it could not demonstrate the failure.)
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
          overrides: {} as Record<string, PostgresDatasetOverride>,
        });
      } catch (error) {
        message = (error as Error).message;
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
