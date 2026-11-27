/** The Postgres catalog per-model builder: tenant scope, safe defaults and label columns. */

import { describe, expect, it } from "vitest";

import type { LwqlCatalogue, LwqlColumnEntry } from "../../../../rules/lwql-catalogue.rules.ts";
import {
  LWQL_PRISMA_MANIFEST,
  prismaManifestModel,
} from "../../../../rules/lwql-prisma-manifest.rules.ts";
import {
  defineCatalogModel,
  type DerivedPostgresView,
  detectDefaultStripReason,
  resolveTenantScope,
  sanitizeDescription,
} from "../lwql-postgres-catalog-model.rules.ts";
import {
  LWQL_POSTGRES_CATALOG,
  LWQL_POSTGRES_CATALOGUE,
} from "../lwql-postgres-view-catalog.rules.ts";
import type { PrismaField, PrismaManifest } from "../lwql-prisma-schema.rules.ts";
import { organizationTenantPath, teamTenantPath } from "../lwql-tenant-paths.rules.ts";

const catalog = LWQL_POSTGRES_CATALOG as readonly DerivedPostgresView[];
const byModel = new Map(catalog.map((view) => [view.postgres!.baseRelation, view]));
const byName = new Map(catalog.map((view) => [view.name, view]));
const SCOPE_FIELDS = new Set(["organizationId", "teamId", "projectId"]);
const POSTGRES_CATALOGUE: LwqlCatalogue = LWQL_POSTGRES_CATALOGUE;

/** The Prisma field an exposed column reads: its `source`, else its own name. */
function sourceField(exposed: string, entry: LwqlColumnEntry | undefined): string {
  if (entry === undefined || entry === "omit") throw new Error(`${exposed} is not exposed`);
  return entry === "inherit" ? exposed : (entry.source ?? exposed);
}

/** A one-model manifest whose fields are all required strings. */
function fakeManifest({
  name,
  primaryKey,
  fields,
}: {
  name: string;
  primaryKey: readonly string[];
  fields: readonly string[];
}): PrismaManifest {
  const field = (fieldName: string): PrismaField => ({
    name: fieldName,
    columnName: fieldName,
    type: "String",
    kind: "scalar",
    isList: false,
    isOptional: false,
    documentation: "",
  });
  return {
    enums: [],
    models: [{ name, tableName: name, documentation: "", primaryKey, fields: fields.map(field) }],
  };
}

describe("given the derived Postgres catalog", () => {
  describe("when a model carries a projectId column", () => {
    /** @scenario "A model with a project column becomes a view without a hand-written definition" */
    it("becomes a snake_case view exposing projectId as TenantId and the rest PascalCase", () => {
      const view = byModel.get("Monitor");
      expect(view, "Monitor should be derived").toBeDefined();
      expect(view!.name).toBe("monitors");
      const tenant = view!.columns.find((column) => column.name === "TenantId");
      expect(tenant?.sourceColumns).toEqual(["projectId"]);
      expect(view!.columns.some((column) => column.name === "CreatedAt")).toBe(true);
    });

    /** @scenario "A project-scoped model maps straight to the caller's tenant" */
    it("reads TenantId straight off projectId with no join", () => {
      const view = byModel.get("Topic")!;
      expect(view.postgres!.tenantPath).toBeUndefined();
      expect(view.postgres!.tenantSourceColumn).toBe("projectId");
      expect(view.columns.find((column) => column.name === "TenantId")?.sourceColumns).toEqual([
        "projectId",
      ]);
    });
  });

  describe("when a model is organization-scoped", () => {
    /** @scenario "An organization-scoped model fans out to one row per project" */
    it("fans out through the same organization helper, one row per project", () => {
      const view = byName.get("virtual_keys")!;
      expect(view.postgres!.tenantPath).toEqual(organizationTenantPath());
      expect(view.dedup.keyColumns[0]).toBe("TenantId");
      expect(view.grain).toContain("counted once across the projects read");
      // The helper is shared: every organization-scoped view carries the same path.
      for (const orgView of ["virtual_keys", "model_providers", "departments"]) {
        expect(byName.get(orgView)!.postgres!.tenantPath).toEqual(organizationTenantPath());
      }
    });
  });

  describe("when a model is team-scoped", () => {
    /** @scenario "A team-scoped model fans out to one row per project in the team" */
    it("fans out through the same team helper, one row per project", () => {
      const view = byName.get("ingestion_sources")!;
      expect(view.postgres!.tenantPath).toEqual(teamTenantPath());
      expect(view.dedup.keyColumns[0]).toBe("TenantId");
      expect(view.grain).toContain("counted once across the projects read");
    });
  });

  describe("when a view's rows fan out to one per project", () => {
    /** @scenario "A fanned-out view keeps one row per entity across the projects read" */
    it("names the exposed primary key as the entity a multi-project read keeps once", () => {
      const entityKeys = (name: string) => byName.get(name)!.postgres!.entityKeyColumns;
      expect(entityKeys("gateway_budgets")).toEqual(["GatewayBudgetId"]);
      expect(entityKeys("ingestion_sources")).toEqual(["IngestionSourceId"]);
      expect(entityKeys("topics")).toBeUndefined();
    });

    /** @scenario "A fanned-out view collapses only on a key that names one row in its table" */
    it("keys each collapsing view by its model's whole primary key, with no scope field", () => {
      const collapsing = catalog.filter((view) => view.postgres!.entityKeyColumns !== undefined);
      expect(collapsing.length).toBeGreaterThan(0);
      for (const view of collapsing) {
        const { baseRelation, entityKeyColumns } = view.postgres!;
        const { primaryKey } = prismaManifestModel(LWQL_PRISMA_MANIFEST, baseRelation);
        const { columns } = POSTGRES_CATALOGUE[view.name]!;
        const keyFields = entityKeyColumns!.map((key) => sourceField(key, columns[key]));
        expect({ view: view.name, keyFields }).toEqual({ view: view.name, keyFields: primaryKey });
        expect(
          primaryKey.filter((field) => SCOPE_FIELDS.has(field)),
          view.name,
        ).toEqual([]);
      }
    });

    /** @scenario "A fanned-out view keyed on its scope field keeps its fan-out" */
    it("names no entity key when the primary key holds the consumed scope field", () => {
      const membership = (name: string, primaryKey: readonly string[]) => {
        const view = defineCatalogModel({
          name,
          table: {
            sourceTable: "FakeOrgMembership",
            columns: {
              TenantId: { source: "organizationId" },
              FakeOrgMembershipId: { source: "id" },
              UserId: { source: "userId" },
            },
          },
          override: {},
          manifest: fakeManifest({
            name: "FakeOrgMembership",
            primaryKey,
            fields: ["id", "organizationId", "userId"],
          }),
        });
        return view.postgres!.entityKeyColumns;
      };

      expect(membership("fake_by_scope", ["organizationId", "userId"])).toBeUndefined();
      expect(membership("fake_by_id", ["id"])).toEqual(["FakeOrgMembershipId"]);
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
      expect(view.postgres!.tenantPath?.slice(1)).toEqual(organizationTenantPath());
      expect(byName.has("gateway_budget_ledgers")).toBe(true);
    });
  });

  describe("when a model carries more than one tenant column", () => {
    /** @scenario "A model with more than one tenant column uses the narrowest" */
    it("takes TenantId from projectId and applies no organization fan-out", () => {
      const model = prismaManifestModel(LWQL_PRISMA_MANIFEST, "CustomLLMModelCost");
      const scope = resolveTenantScope(model, undefined);
      expect(scope.kind).toBe("project");
      expect(scope.column).toBe("projectId");
      expect(scope.tenantPath).toEqual([]);
      expect(byName.get("custom_llm_model_costs")!.postgres!.tenantPath).toBeUndefined();
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
              detectDefaultStripReason(source),
              `${view.name}.${column.name} exposes secret material`,
            ).toBeUndefined();
          }
        }
      }
      // A column ending in Id is not treated as a key: it survives.
      const projects = byName.get("projects")!;
      expect(projects.columns.some((column) => column.name === "OwnerUserId")).toBe(true);
      expect(projects.skipColumns.apiKey).toContain("secret");
    });

    it("classifies secret, email and surviving names", () => {
      expect(detectDefaultStripReason("apiKey")).toBeDefined();
      expect(detectDefaultStripReason("hashedSecret")).toBeDefined();
      expect(detectDefaultStripReason("ingestSecretHash")).toBeDefined();
      expect(detectDefaultStripReason("lwqlKey")).toBeDefined();
      expect(detectDefaultStripReason("s3AccessKeyId")).toBeDefined();
      // A plural key/hash suffix is a secret even with no secret word in it.
      expect(detectDefaultStripReason("customKeys")).toBeDefined();
      expect(detectDefaultStripReason("email")).toBeDefined();
      expect(detectDefaultStripReason("reviewerEmail")).toBeDefined();
      // A name merely containing "email" is stripped too, not just an exact
      // match or `Email` suffix.
      expect(detectDefaultStripReason("reviewer_email")).toBeDefined();
      expect(detectDefaultStripReason("notificationEmails")).toBeDefined();
      expect(detectDefaultStripReason("emailAddress")).toBeDefined();
      expect(detectDefaultStripReason("parentId")).toBeUndefined();
      // `tokens` is a count, not a credential — kept.
      expect(detectDefaultStripReason("promptTokens")).toBeUndefined();
      expect(detectDefaultStripReason("completionTokens")).toBeUndefined();
      expect(detectDefaultStripReason("userId")).toBeUndefined();
    });

    /** @scenario "Identity tables are skipped and person columns stay opaque" */
    it("does not derive User, Team or Organization and keeps userId opaque", () => {
      expect(byModel.has("User")).toBe(false);
      expect(byModel.has("Team")).toBe(false);
      expect(byModel.has("Organization")).toBe(false);
      const userId = byName.get("annotations")!.columns.find((column) => column.name === "UserId");
      expect(userId).toBeDefined();
      expect(userId!.gates).toEqual([]);
      expect(userId!.type).toBe("Nullable(String)");
    });
  });

  describe("when a Postgres label column is classified", () => {
    /**
     * Prisma flattens an enum and a free-text `String` to the same ClickHouse `String`, so a label
     * would be gated `output` by the name-blind default and — because the validator gates a bare
     * name catalog-wide — withhold the same name on the ClickHouse half.
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
      // `monitors.Preconditions` is a plain `String` body, not an enum and not a label.
      const body = byName
        .get("monitors")!
        .columns.find((column) => column.name === "Preconditions")!;
      expect(body.type).toBe("String");
      expect(body.gates).toEqual(["output"]);
    });

    /**
     * A JSON body whose bare name is a label elsewhere is aliased to a non-label
     * name so it keeps its `output` gate without forcing that gate onto the
     * unrelated labels.
     */
    it("aliases a JSON body away from a label name and keeps it gated", () => {
      const analytics = byName.get("analytics")!;
      expect(analytics.columns.some((column) => column.name === "Value")).toBe(false);
      const valueJson = analytics.columns.find((column) => column.name === "ValueJson")!;
      expect(valueJson.sourceColumns).toEqual(["value"]);
      expect(valueJson.gates).toEqual(["output"]);
    });
  });

  describe("when a model has no temporal column", () => {
    /** @scenario "A model with no timestamp column advertises no time column" */
    it("carries no time column instead of falling back to a key or TenantId", () => {
      const view = byName.get("ai_tool_entry_departments")!;
      expect(
        view.columns.some((column) => column.type.includes("DateTime64")),
        "fixture assumption: the view exposes no DateTime column",
      ).toBe(false);
      expect(view.columns.some((column) => column.name === "CreatedAt")).toBe(false);
      expect(view.timeColumn).toBeUndefined();
    });

    /** @scenario "A model with a CreatedAt column keeps it as the time column" */
    it("still uses CreatedAt when the model exposes one", () => {
      expect(byModel.get("Monitor")!.timeColumn).toBe("CreatedAt");
    });
  });
});

describe("sanitizeDescription", () => {
  it("keeps the first sentence and drops later internal prose", () => {
    expect(
      sanitizeDescription(
        "The dated match table. Dating is what makes it survivable; nothing is ever silently rewritten.",
      ),
    ).toBe("The dated match table.");
  });

  it("strips spec paths, ADR and PR references from the first sentence", () => {
    expect(
      sanitizeDescription("Why an outbox delivery failed (specs/ops/dead-letter.feature)."),
    ).toBe("Why an outbox delivery failed.");
    expect(sanitizeDescription("The platform user (ADR-128 §9 step 2, #42).")).toBe(
      "The platform user.",
    );
  });

  it("strips JSON-shape and angle-bracket fragments (MDX-hostile)", () => {
    expect(sanitizeDescription("The tool config { setupCommand, url } and <b>markup</b>.")).toBe(
      "The tool config and markup.",
    );
  });

  it("joins wrapped lines and takes only the first paragraph", () => {
    expect(sanitizeDescription("Org-scoped catalog of AI\ntools.\n\nInternal rationale.")).toBe(
      "Org-scoped catalog of AI tools.",
    );
  });

  it("appends a period when the first sentence has none", () => {
    expect(sanitizeDescription("A single line with no terminator")).toBe(
      "A single line with no terminator.",
    );
  });

  it("returns empty when nothing usable remains", () => {
    expect(sanitizeDescription("")).toBe("");
    expect(sanitizeDescription("   \n  ")).toBe("");
  });

  it("drops parentheticals left empty or containing only connector words after stripping", () => {
    // IngestionSource model: cf. and file references stripped, leaving (cf.)
    expect(
      sanitizeDescription(
        "Per-platform fleet configuration that connects a closed SaaS " +
          "product's audit / OTel / S3 stream to LangWatch's Activity " +
          "Monitor (cf. specs/ai-gateway/governance/activity-monitor.feature " +
          "+ ingestion-sources.feature, docs/ai-gateway/governance/architecture.md).",
      ),
    ).toBe(
      "Per-platform fleet configuration that connects a closed SaaS product's " +
        "audit / OTel / S3 stream to LangWatch's Activity Monitor.",
    );
  });

  it("keeps plus signs inside tokens like svg+xml when surrounded by non-whitespace", () => {
    expect(sanitizeDescription("SVG content type data:image/svg+xml for rendering.")).toBe(
      "SVG content type data:image/svg+xml for rendering.",
    );
  });
});
