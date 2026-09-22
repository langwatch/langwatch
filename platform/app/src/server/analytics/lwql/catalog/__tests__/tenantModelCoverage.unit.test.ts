/**
 * Every model in the committed Prisma manifest is accounted for by the
 * include list.
 *
 * The Postgres catalog's opt-in design
 * ({@link ../derivePostgresCatalog#derivePostgresCatalog}) only holds if the
 * accounting is exhaustive and non-overlapping: a model is exactly one of
 * included (named on {@link LWQL_POSTGRES_INCLUDED_MODELS}, so its table backs a
 * derived view) or unlisted (everything else, simply not queryable). This guards
 * that invariant directly against the manifest and pins the split with literal
 * counts, so a model quietly entering or leaving the catalog — or the include
 * list drifting from the manifest — shows up as a failing assertion rather than
 * a silent change in `derived.length`.
 *
 * The mirror of `./tenantTableCoverage.unit.test.ts` for the ClickHouse half.
 */

import { describe, expect, it } from "vitest";

import { lwqlPostgresApprovedViewStatements } from "../../provisioning/catalogStatements";
import {
  derivePostgresCatalog,
  type PostgresDatasetOverride,
} from "../derivePostgresCatalog";
import { LWQL_VIEW_CATALOG } from "../lwqlViews";
import { LWQL_POSTGRES_INCLUDED_MODELS } from "../postgresIncludedModels";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../postgresViews";
import { LWQL_PRISMA_MANIFEST } from "../prismaManifest";
import type { PrismaField, PrismaManifest } from "../prismaSchema";

const INCLUDED_MODEL_COUNT = 87;
const UNLISTED_MODEL_COUNT = 56;

/**
 * Organization/admin-tier models the application reads only behind a distinct
 * permission a project's `analytics:view` key does not hold. None may be on the
 * include list — listing them would let any project API key read organization
 * billing, audit and webhook data through the analytics surface.
 */
const PERMISSION_GATED_MODELS = [
  "AuditLog",
  "WebhookEndpoint",
  "Subscription",
  "Invoice",
  "InvoiceItem",
  "BillingMeterCheckpoint",
] as const;

/**
 * Models that carry live credential material. Each also carries `projectId`
 * or `organizationId`, so the tenant-column derivation would happily grant
 * one a view — and each model's ciphertext columns are not guaranteed to
 * match the secret-name stripping the safe defaults apply, so an included
 * credential model could leak key material through a derived view. None may
 * ever be on the include list.
 */
const CREDENTIAL_BEARING_MODELS = [
  "ProjectSecret",
  "ApiKey",
  "SsoCredential",
  "AccountCredential",
  "Passkey",
  "TwoFactor",
  "ScimToken",
] as const;

const modelNames = LWQL_PRISMA_MANIFEST.models.map((model) => model.name);
const tableByModel = new Map(
  LWQL_PRISMA_MANIFEST.models.map((model) => [model.name, model.tableName]),
);
const includeSet = new Set(LWQL_POSTGRES_INCLUDED_MODELS);

const derived = derivePostgresCatalog({
  manifest: LWQL_PRISMA_MANIFEST,
  include: LWQL_POSTGRES_INCLUDED_MODELS,
  overrides: LWQL_POSTGRES_ALL_OVERRIDES,
});
const derivedBaseRelations = new Set(
  derived.map((view) => view.postgres!.baseRelation),
);

const idField: PrismaField = {
  name: "id",
  columnName: "id",
  type: "String",
  kind: "scalar",
  isList: false,
  isOptional: false,
  documentation: "",
};
const projectIdField: PrismaField = {
  name: "projectId",
  columnName: "projectId",
  type: "String",
  kind: "scalar",
  isList: false,
  isOptional: false,
  documentation: "",
};

describe("given every model in the committed Prisma manifest", () => {
  it("derives a view for exactly the included models", () => {
    for (const model of modelNames) {
      // An included model backs a derived view; an unlisted one does not.
      expect(derivedBaseRelations.has(tableByModel.get(model)!)).toBe(
        includeSet.has(model),
      );
    }
  });

  it("derives every include entry exactly once", () => {
    for (const model of LWQL_POSTGRES_INCLUDED_MODELS) {
      const backing = derived.filter(
        (view) => view.postgres!.baseRelation === tableByModel.get(model),
      );
      expect(backing.length, `"${model}" should be derived exactly once`).toBe(
        1,
      );
    }
    expect(derived.length).toBe(LWQL_POSTGRES_INCLUDED_MODELS.length);
  });

  it("pins the current split with literal counts, so drift is visible", () => {
    const unlisted = modelNames.filter((model) => !includeSet.has(model));
    expect(derived.length).toBe(INCLUDED_MODEL_COUNT);
    expect(unlisted.length).toBe(UNLISTED_MODEL_COUNT);
    expect(derived.length + unlisted.length).toBe(modelNames.length);
  });

  it("never lists a model the manifest does not carry", () => {
    for (const model of LWQL_POSTGRES_INCLUDED_MODELS) {
      expect(
        modelNames,
        `include entry "${model}" names no manifest model`,
      ).toContain(model);
    }
  });

  it("never includes an organization/admin-tier permission-gated model", () => {
    for (const model of PERMISSION_GATED_MODELS) {
      expect(
        includeSet.has(model),
        `${model} is permission-gated and must not be on the include list`,
      ).toBe(false);
      expect(
        derivedBaseRelations.has(tableByModel.get(model)!),
        `${model} is permission-gated and must not be a derived view`,
      ).toBe(false);
    }
  });

  it("never includes a credential-bearing model", () => {
    for (const model of CREDENTIAL_BEARING_MODELS) {
      expect(
        includeSet.has(model),
        `${model} carries credential material and must not be on the include list`,
      ).toBe(false);
      expect(
        derivedBaseRelations.has(tableByModel.get(model)!),
        `${model} carries credential material and must not be a derived view`,
      ).toBe(false);
    }
  });

  it("never includes the identity scope User, Team or Organization", () => {
    for (const identity of ["User", "Team", "Organization"]) {
      expect(includeSet.has(identity), `${identity} must not be listed`).toBe(
        false,
      );
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

  describe("when a tenant-scoped model is not on the include list", () => {
    /** @scenario "A model that is not on the include list is not queryable" */
    it("derives no view for it and no grant references it", () => {
      // Two disjoint names (no substring overlap) so the grant assertion below
      // cannot pass by accident.
      const manifest: PrismaManifest = {
        models: [
          {
            name: "Zebra",
            tableName: "Zebra",
            documentation: "",
            primaryKey: ["id"],
            fields: [idField, projectIdField],
          },
          {
            name: "Quokka",
            tableName: "Quokka",
            documentation: "",
            primaryKey: ["id"],
            fields: [idField, projectIdField],
          },
        ],
        enums: [],
      };
      const views = derivePostgresCatalog({
        manifest,
        include: ["Zebra"],
        overrides: {} as Record<string, PostgresDatasetOverride>,
      });
      const baseRelations = views.map((view) => view.postgres!.baseRelation);
      expect(baseRelations).toEqual(["Zebra"]);
      expect(baseRelations).not.toContain("Quokka");

      // The approved-view statements the app grants from name only the listed
      // model's table — the unlisted one appears nowhere.
      const statements = lwqlPostgresApprovedViewStatements({
        schema: "public",
        views,
      }).join("\n");
      expect(statements).toContain("Zebra");
      expect(statements).not.toContain("Quokka");
    });
  });

  describe("when an included model has no owning tenant column and no tenantVia", () => {
    /** @scenario "An include-listed model with no owning tenant column and no tenantVia fails the build" */
    it("fails the build and names the model", () => {
      // The model carries only an internal `tenantId` column — a tenant column,
      // but not the owning project/team/organization one the derivation accepts,
      // and it has no tenantVia override. Listed, so it must derive; it cannot.
      const manifest: PrismaManifest = {
        models: [
          {
            name: "BrandNewThing",
            tableName: "BrandNewThing",
            documentation: "",
            primaryKey: ["id"],
            fields: [
              idField,
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
          include: ["BrandNewThing"],
          overrides: {} as Record<string, PostgresDatasetOverride>,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("BrandNewThing");
      expect(message).toContain("owning tenant column");
      expect(message).toContain("include list");
    });
  });

  describe("when the include list names a model that does not exist", () => {
    /** @scenario "An include-list entry whose model no longer exists fails the build" */
    it("fails the build and names the entry", () => {
      let message = "";
      try {
        derivePostgresCatalog({
          manifest: LWQL_PRISMA_MANIFEST,
          include: ["NoSuchModel"],
          overrides: {} as Record<string, PostgresDatasetOverride>,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("NoSuchModel");
      expect(message).toContain("names no manifest model");
    });
  });

  describe("when the include list names the same model twice", () => {
    it("fails the build and names the entry", () => {
      const manifest: PrismaManifest = {
        models: [
          {
            name: "Zebra",
            tableName: "Zebra",
            documentation: "",
            primaryKey: ["id"],
            fields: [idField, projectIdField],
          },
        ],
        enums: [],
      };
      let message = "";
      try {
        derivePostgresCatalog({
          manifest,
          include: ["Zebra", "Zebra"],
          overrides: {} as Record<string, PostgresDatasetOverride>,
        });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).toContain("Zebra");
      expect(message).toContain("is listed more than once");
    });
  });
});
