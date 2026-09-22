/**
 * The Postgres catalog derivation: tenant scope, safe defaults and label
 * columns.
 *
 * These bind the @unit scenarios of `specs/lwql/postgres-catalog.feature` that
 * are about the derivation itself — naming/type helpers move to
 * `./derivePostgresCatalog.naming.unit.test.ts`, override handling (the six
 * formerly-hand-written views, re-admits, the skip-list guard) to
 * `./derivePostgresCatalog.overrides.unit.test.ts`, the coverage guard lives
 * in `./tenantModelCoverage.unit.test.ts`, and the content-gating and
 * ground-truth scenarios bind elsewhere.
 *
 * @see ../derivePostgresCatalog.ts — the code under test
 * @see specs/lwql/postgres-catalog.feature
 */

import { describe, expect, it } from "vitest";
import {
  organizationTenantPath,
  teamTenantPath,
} from "../../provisioning/postgresMapping";
import {
  derivePostgresCatalog,
  isStrippedByDefault,
  resolveTenantScope,
} from "../derivePostgresCatalog";
import { LWQL_POSTGRES_SKIPPED_MODELS } from "../postgresSkippedModels";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../postgresViews";
import { LWQL_PRISMA_MANIFEST, prismaManifestModel } from "../prismaManifest";

const catalog = derivePostgresCatalog({
  manifest: LWQL_PRISMA_MANIFEST,
  skip: LWQL_POSTGRES_SKIPPED_MODELS,
  overrides: LWQL_POSTGRES_ALL_OVERRIDES,
});
const byModel = new Map(
  catalog.map((view) => [view.postgres!.baseRelation, view]),
);
const byName = new Map(catalog.map((view) => [view.name, view]));

describe("given the derived Postgres catalog", () => {
  describe("when a model carries a projectId column", () => {
    /** @scenario "A model with a project column becomes a view without a hand-written definition" */
    it("becomes a snake_case view exposing projectId as TenantId and the rest PascalCase", () => {
      const view = byModel.get("Monitor");
      expect(view, "Monitor should be derived").toBeDefined();
      expect(view!.name).toBe("monitors");
      const tenant = view!.columns.find((column) => column.name === "TenantId");
      expect(tenant?.sourceColumns).toEqual(["projectId"]);
      expect(view!.columns.some((column) => column.name === "CreatedAt")).toBe(
        true,
      );
    });

    /** @scenario "A project-scoped model maps straight to the caller's tenant" */
    it("reads TenantId straight off projectId with no join", () => {
      const view = byModel.get("Topic")!;
      expect(view.postgres!.tenantPath).toBeUndefined();
      expect(view.postgres!.tenantSourceColumn).toBe("projectId");
      expect(
        view.columns.find((column) => column.name === "TenantId")
          ?.sourceColumns,
      ).toEqual(["projectId"]);
    });
  });

  describe("when a model is organization-scoped", () => {
    /** @scenario "An organization-scoped model fans out to one row per project" */
    it("fans out through the same organization helper, one row per project", () => {
      const view = byName.get("virtual_keys")!;
      expect(view.postgres!.tenantPath).toEqual(organizationTenantPath());
      expect(view.dedup.keyColumns[0]).toBe("TenantId");
      expect(view.grain).toContain("once per project");
      // The helper is shared: every organization-scoped view carries the same path.
      for (const orgView of [
        "virtual_keys",
        "model_providers",
        "departments",
      ]) {
        expect(byName.get(orgView)!.postgres!.tenantPath).toEqual(
          organizationTenantPath(),
        );
      }
    });
  });

  describe("when a model is team-scoped", () => {
    /** @scenario "A team-scoped model fans out to one row per project in the team" */
    it("fans out through the same team helper, one row per project", () => {
      const view = byName.get("ingestion_sources")!;
      expect(view.postgres!.tenantPath).toEqual(teamTenantPath());
      expect(view.dedup.keyColumns[0]).toBe("TenantId");
      expect(view.grain).toContain("once per project");
    });
  });

  describe("when a model has no tenant column but a declared parent", () => {
    /** @scenario "A model without a tenant column is reached through a declared parent" */
    it("takes its TenantId from the parent and needs no skip entry", () => {
      const view = byName.get("gateway_budget_ledgers")!;
      expect(view.postgres!.tenantPath?.[0]).toEqual({
        relation: "GatewayBudget",
        alias: "j0",
        on: { from: "budgetId", to: "id" },
      });
      // The parent is organization-scoped, so the tail is the org helper.
      expect(view.postgres!.tenantPath?.slice(1)).toEqual(
        organizationTenantPath(),
      );
      expect(LWQL_POSTGRES_SKIPPED_MODELS.GatewayBudgetLedger).toBeUndefined();
    });
  });

  describe("when a model carries more than one tenant column", () => {
    /** @scenario "A model with more than one tenant column uses the narrowest" */
    it("takes TenantId from projectId and applies no organization fan-out", () => {
      const model = prismaManifestModel(
        LWQL_PRISMA_MANIFEST,
        "CustomLLMModelCost",
      );
      const scope = resolveTenantScope(model, undefined);
      expect(scope.kind).toBe("project");
      expect(scope.column).toBe("projectId");
      expect(scope.tenantPath).toEqual([]);
      expect(
        byName.get("custom_llm_model_costs")!.postgres!.tenantPath,
      ).toBeUndefined();
    });
  });

  describe("when the safe defaults are applied", () => {
    /** @scenario "Secret material is stripped from every derived view" */
    it("strips secrets from every view and keeps an Id column as an id", () => {
      // Assert against the production classifier rather than a copy of its
      // regexes, so the two can never drift: no exposed column reads from a
      // source the safe defaults would have stripped. Checked on the source
      // column, not the exposed alias — an alias like `EmailSuppressionId`
      // contains "email" yet reads from a plain `id`.
      for (const view of catalog) {
        for (const column of view.columns) {
          for (const source of column.sourceColumns) {
            expect(
              isStrippedByDefault(source),
              `${view.name}.${column.name} exposes secret material`,
            ).toBeUndefined();
          }
        }
      }
      // A column ending in Id is not treated as a key: it survives.
      const projects = byName.get("projects")!;
      expect(
        projects.columns.some((column) => column.name === "OwnerUserId"),
      ).toBe(true);
      expect(projects.skipColumns.apiKey).toContain("secret");
    });

    it("classifies secret, email and surviving names", () => {
      expect(isStrippedByDefault("apiKey")).toBeDefined();
      expect(isStrippedByDefault("hashedSecret")).toBeDefined();
      expect(isStrippedByDefault("ingestSecretHash")).toBeDefined();
      expect(isStrippedByDefault("lwqlKey")).toBeDefined();
      expect(isStrippedByDefault("s3AccessKeyId")).toBeDefined();
      // A plural key/hash suffix is a secret even with no secret word in it.
      expect(isStrippedByDefault("customKeys")).toBeDefined();
      expect(isStrippedByDefault("email")).toBeDefined();
      expect(isStrippedByDefault("reviewerEmail")).toBeDefined();
      // A name merely containing "email" is stripped too, not just an exact
      // match or `Email` suffix.
      expect(isStrippedByDefault("reviewer_email")).toBeDefined();
      expect(isStrippedByDefault("notificationEmails")).toBeDefined();
      expect(isStrippedByDefault("emailAddress")).toBeDefined();
      expect(isStrippedByDefault("parentId")).toBeUndefined();
      // `tokens` is a count, not a credential — kept.
      expect(isStrippedByDefault("promptTokens")).toBeUndefined();
      expect(isStrippedByDefault("completionTokens")).toBeUndefined();
      expect(isStrippedByDefault("userId")).toBeUndefined();
    });

    /** @scenario "Identity tables are skipped and person columns stay opaque" */
    it("does not derive User, Team or Organization and keeps userId opaque", () => {
      expect(byModel.has("User")).toBe(false);
      expect(byModel.has("Team")).toBe(false);
      expect(byModel.has("Organization")).toBe(false);
      const userId = byName
        .get("annotations")!
        .columns.find((column) => column.name === "UserId");
      expect(userId).toBeDefined();
      expect(userId!.gates).toEqual([]);
      expect(userId!.type).toBe("Nullable(String)");
    });
  });

  describe("when a Postgres label column is classified", () => {
    /**
     * Prisma flattens an enum and a free-text `String` to the same ClickHouse
     * `String`, so a label would be gated `output` by the name-blind default and
     * — because the validator gates a bare name catalog-wide — withhold the same
     * name on the ClickHouse half. The derivation recognises the two label shapes
     * explicitly so they stay ungated.
     */
    it("leaves an enum column ungated", () => {
      const purpose = byName
        .get("virtual_keys")!
        .columns.find((column) => column.name === "Purpose")!;
      expect(purpose.gates).toEqual([]);
    });

    it("leaves a label-named String column ungated", () => {
      const provider = byName
        .get("model_providers")!
        .columns.find((column) => column.name === "Provider")!;
      expect(provider.type).toBe("String");
      expect(provider.gates).toEqual([]);
    });

    it("still gates a free-text String body that is not a label", () => {
      // `agents.Config` is a plain `String` body, not an enum and not a label
      // suffix, so the widening leaves it gated `output` exactly as before.
      const config = byName
        .get("agents")!
        .columns.find((column) => column.name === "Config")!;
      expect(config.type).toBe("String");
      expect(config.gates).toEqual(["output"]);
    });

    /**
     * A JSON body whose bare name is a label elsewhere is aliased to a non-label
     * name so it keeps its `output` gate without forcing that gate onto the
     * unrelated labels.
     */
    it("aliases a JSON body away from a label name and keeps it gated", () => {
      const analytics = byName.get("analytics")!;
      expect(analytics.columns.some((column) => column.name === "Value")).toBe(
        false,
      );
      const valueJson = analytics.columns.find(
        (column) => column.name === "ValueJson",
      )!;
      expect(valueJson.sourceColumns).toEqual(["value"]);
      expect(valueJson.gates).toEqual(["output"]);
    });
  });
});
