/**
 * The Postgres catalog derivation: naming, tenant scope, safe defaults and
 * overrides.
 *
 * These bind the @unit scenarios of `specs/lwql/postgres-catalog.feature` that
 * are about the derivation itself — the coverage guard lives in
 * `./tenantModelCoverage.unit.test.ts`, and the content-gating and
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
  clickHouseTypeFor,
  derivePostgresCatalog,
  exposedColumnName,
  isStrippedByDefault,
  type PostgresDatasetOverride,
  postgresDatasetName,
  resolveTenantScope,
} from "../derivePostgresCatalog";
import {
  assertPostgresSkipReasons,
  LWQL_POSTGRES_SKIPPED_MODELS,
  POSTGRES_SKIP_REASON_PREFIXES,
} from "../postgresSkippedModels";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../postgresViews";
import { LWQL_PRISMA_MANIFEST, prismaManifestModel } from "../prismaManifest";
import type { PrismaField } from "../prismaSchema";

const catalog = derivePostgresCatalog({
  manifest: LWQL_PRISMA_MANIFEST,
  skip: LWQL_POSTGRES_SKIPPED_MODELS,
  overrides: LWQL_POSTGRES_ALL_OVERRIDES,
});
const byModel = new Map(
  catalog.map((view) => [view.postgres!.baseRelation, view]),
);
const byName = new Map(catalog.map((view) => [view.name, view]));

const scalarField = (over: Partial<PrismaField>): PrismaField => ({
  name: "f",
  columnName: "f",
  type: "String",
  kind: "scalar",
  isList: false,
  isOptional: false,
  documentation: "",
  ...over,
});

describe("given the Postgres catalog naming helpers", () => {
  describe("when a model name becomes a view name", () => {
    it("snake-cases acronym-aware and pluralises the last word", () => {
      expect(postgresDatasetName("CustomLLMModelCost")).toBe(
        "custom_llm_model_costs",
      );
      expect(postgresDatasetName("Topic")).toBe("topics");
      expect(postgresDatasetName("RoutingPolicy")).toBe("routing_policies");
      expect(postgresDatasetName("Analytics")).toBe("analytics");
      expect(postgresDatasetName("AnnotationQueue")).toBe("annotation_queues");
    });
  });

  describe("when a field name becomes a column name", () => {
    it("maps the primary key `id` to `<Model>Id` and PascalCases the rest", () => {
      expect(
        exposedColumnName({
          modelName: "Topic",
          fieldName: "id",
          primaryKey: ["id"],
        }),
      ).toBe("TopicId");
      expect(
        exposedColumnName({
          modelName: "Topic",
          fieldName: "embeddings_model",
          primaryKey: ["id"],
        }),
      ).toBe("EmbeddingsModel");
      expect(
        exposedColumnName({
          modelName: "Topic",
          fieldName: "p95Distance",
          primaryKey: ["id"],
        }),
      ).toBe("P95Distance");
    });
  });

  describe("when a Prisma type becomes a ClickHouse type", () => {
    it("maps each scalar, wraps lists and optionals, strips binary", () => {
      expect(clickHouseTypeFor(scalarField({ type: "String" }))).toBe("String");
      expect(clickHouseTypeFor(scalarField({ type: "Int" }))).toBe("Int32");
      expect(clickHouseTypeFor(scalarField({ type: "BigInt" }))).toBe("Int64");
      expect(clickHouseTypeFor(scalarField({ type: "Float" }))).toBe("Float64");
      expect(clickHouseTypeFor(scalarField({ type: "Boolean" }))).toBe("Bool");
      expect(clickHouseTypeFor(scalarField({ type: "DateTime" }))).toBe(
        "DateTime64(3)",
      );
      expect(clickHouseTypeFor(scalarField({ type: "Json" }))).toBe("String");
      expect(
        clickHouseTypeFor(scalarField({ kind: "enum", type: "MyEnum" })),
      ).toBe("String");
      expect(
        clickHouseTypeFor(
          scalarField({
            type: "Decimal",
            decimal: { precision: 10, scale: 2 },
          }),
        ),
      ).toBe("Decimal(10, 2)");
      expect(clickHouseTypeFor(scalarField({ type: "Decimal" }))).toBe(
        "Decimal(65, 30)",
      );
      expect(
        clickHouseTypeFor(scalarField({ type: "String", isOptional: true })),
      ).toBe("Nullable(String)");
      expect(
        clickHouseTypeFor(scalarField({ type: "String", isList: true })),
      ).toBe("Array(String)");
      expect(clickHouseTypeFor(scalarField({ type: "Bytes" }))).toBeNull();
      expect(
        clickHouseTypeFor(scalarField({ kind: "unsupported", type: "geo" })),
      ).toBeNull();
    });
  });
});

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
        "subscriptions",
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
      const secret =
        /(apikey|accesskey|secret|password|credential|privatekey|publickey|lwqlkey|pepper)/i;
      for (const view of catalog) {
        for (const column of view.columns) {
          const lower = column.name.toLowerCase();
          expect(
            secret.test(lower),
            `${view.name}.${column.name} exposes secret material`,
          ).toBe(false);
          const suffixSecret =
            (lower.endsWith("token") ||
              lower.endsWith("hash") ||
              lower.endsWith("key")) &&
            !lower.endsWith("id");
          expect(
            suffixSecret,
            `${view.name}.${column.name} exposes secret material`,
          ).toBe(false);
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

  describe("when the six formerly-hand-written views are derived", () => {
    /** @scenario "A hand-written view is an override on the derived default, not a second definition" */
    it("produces each one exactly once under its unchanged exposed names", () => {
      const legacy: Record<string, Record<string, string>> = {
        annotations: {
          TenantId: "projectId",
          AnnotationId: "id",
          TraceId: "traceId",
          IsThumbsUp: "isThumbsUp",
          CreatedAt: "createdAt",
          UpdatedAt: "updatedAt",
        },
        projects: {
          TenantId: "id",
          ProjectName: "name",
          ProjectSlug: "slug",
          CreatedAt: "createdAt",
        },
        prompts: {
          TenantId: "projectId",
          PromptId: "id",
          PromptName: "name",
          PromptHandle: "handle",
          CreatedAt: "createdAt",
          DeletedAt: "deletedAt",
        },
        prompt_versions: {
          TenantId: "projectId",
          PromptVersionId: "id",
          PromptId: "configId",
          VersionNumber: "version",
          CreatedAt: "createdAt",
        },
        experiments: {
          TenantId: "projectId",
          ExperimentId: "id",
          ExperimentName: "name",
          ExperimentSlug: "slug",
          ExperimentType: "type",
          CreatedAt: "createdAt",
          ArchivedAt: "archivedAt",
        },
        batch_evaluations: {
          TenantId: "projectId",
          BatchEvaluationId: "id",
          ExperimentId: "experimentId",
          DatasetId: "datasetId",
          Cost: "cost",
          CreatedAt: "createdAt",
        },
      };
      for (const [name, columns] of Object.entries(legacy)) {
        const view = byName.get(name);
        expect(view, `${name} should be derived`).toBeDefined();
        expect(catalog.filter((entry) => entry.name === name)).toHaveLength(1);
        for (const [exposed, source] of Object.entries(columns)) {
          const column = view!.columns.find((entry) => entry.name === exposed);
          expect(
            column?.sourceColumns,
            `${name}.${exposed} keeps reading ${source}`,
          ).toEqual([source]);
        }
      }
      // The legacy Cost column still carries its USD unit and cost gate.
      const cost = byName
        .get("batch_evaluations")!
        .columns.find((column) => column.name === "Cost")!;
      expect(cost.unit).toBe("USD");
      expect(cost.gates).toEqual(["costs"]);
    });
  });

  describe("when the topics view is derived", () => {
    /** @scenario "Topic clustering internals are not exposed" */
    it("exposes the name and hierarchy, not the clustering internals", () => {
      const columns = byName
        .get("topics")!
        .columns.map((column) => column.name);
      expect(columns).toContain("TopicId");
      expect(columns).toContain("TopicName");
      expect(columns).toContain("ParentTopicId");
      expect(columns).toContain("TenantId");
      expect(columns).not.toContain("Centroid");
      expect(columns).not.toContain("EmbeddingsModel");
      expect(columns).not.toContain("P95Distance");
    });
  });

  describe("when an override re-admits a stripped column", () => {
    /** @scenario "An override that re-admits a stripped column carries a reason" */
    it("requires a reason and refuses one without", () => {
      const withReason: Record<string, PostgresDatasetOverride> = {
        Annotation: { reAdmit: { Email: "the reviewer's own email, opt-in" } },
      };
      expect(() =>
        derivePostgresCatalog({
          manifest: LWQL_PRISMA_MANIFEST,
          skip: LWQL_POSTGRES_SKIPPED_MODELS,
          overrides: { ...LWQL_POSTGRES_ALL_OVERRIDES, ...withReason },
        }),
      ).not.toThrow();

      const withoutReason: Record<string, PostgresDatasetOverride> = {
        Annotation: { reAdmit: { Email: "" } },
      };
      expect(() =>
        derivePostgresCatalog({
          manifest: LWQL_PRISMA_MANIFEST,
          skip: LWQL_POSTGRES_SKIPPED_MODELS,
          overrides: { ...LWQL_POSTGRES_ALL_OVERRIDES, ...withoutReason },
        }),
      ).toThrow(/re-admits/);
    });
  });

  describe("when a sensitive column dodges the name rules", () => {
    /** The column is recorded as stripped and no exposed column reads it. */
    const assertStripped = (baseRelation: string, source: string) => {
      const view = byModel.get(baseRelation);
      expect(view, `${baseRelation} should be derived`).toBeDefined();
      expect(
        view!.skipColumns[source],
        `${baseRelation}.${source} should be recorded as stripped`,
      ).toBeDefined();
      expect(
        view!.columns.some((column) => column.sourceColumns.includes(source)),
        `${baseRelation}.${source} must not be exposed`,
      ).toBe(false);
    };

    it("strips WebhookEndpoint.sqsExternalId despite its Id suffix", () => {
      assertStripped("WebhookEndpoint", "sqsExternalId");
    });

    it("strips ModelProvider.customKeys by the plural-key suffix rule", () => {
      const view = byModel.get("ModelProvider")!;
      expect(view.columns.some((column) => column.name === "CustomKeys")).toBe(
        false,
      );
      expect(view.skipColumns.customKeys).toBeDefined();
    });

    it("strips DiscoveredPerson raw external identity", () => {
      assertStripped("DiscoveredPerson", "rawActorId");
      assertStripped("DiscoveredPerson", "displayText");
    });

    it("strips AuditLog request forensics and payload diffs", () => {
      for (const source of [
        "ipAddress",
        "userAgent",
        "args",
        "before",
        "after",
      ]) {
        assertStripped("AuditLog", source);
      }
    });

    it("strips IngestionSource credential-bearing config", () => {
      assertStripped("IngestionSource", "parserConfig");
      assertStripped("IngestionSource", "pollerCursor");
    });
  });

  describe("when the skip list is validated", () => {
    /** @scenario "A skip needs a recorded reason" */
    it("accepts every category prefix and refuses empty, low-value or unprefixed reasons", () => {
      for (const prefix of POSTGRES_SKIP_REASON_PREFIXES) {
        expect(
          () => assertPostgresSkipReasons({ X: `${prefix} really` }),
          `"${prefix}" should be an accepted category`,
        ).not.toThrow();
      }
      expect(() => assertPostgresSkipReasons({ X: "" })).toThrow();
      expect(() => assertPostgresSkipReasons({ X: "low value" })).toThrow();
      expect(() =>
        assertPostgresSkipReasons({ X: "some arbitrary unprefixed reason" }),
      ).toThrow();
    });
  });
});
