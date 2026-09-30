/**
 * The Postgres catalog's per-model override handling: the six formerly-hand-written views, topic
 * clustering internals, the columns the builder refuses and name-rule-dodging columns.
 */

import { describe, expect, it } from "vitest";

import { LangWatchQLPostgresViewsService } from "../../services/langwatch-ql-postgres-views.service.ts";
import type { LwqlTableCatalogue } from "../lwql-catalogue.rules.ts";
import {
  type DerivedPostgresView,
  defineCatalogModel,
} from "../lwql-postgres-catalog-model.rules.ts";
import {
  LWQL_POSTGRES_ALL_OVERRIDES,
  LWQL_POSTGRES_CATALOG,
  LWQL_POSTGRES_CATALOGUE,
} from "../lwql-postgres-view-catalog.rules.ts";

const postgresViews = LangWatchQLPostgresViewsService.create();

const catalog = LWQL_POSTGRES_CATALOG as readonly DerivedPostgresView[];
const byModel = new Map(catalog.map((view) => [view.postgres!.baseRelation, view]));
const byName = new Map(catalog.map((view) => [view.name, view]));

describe("given the derived Postgres catalog's overrides", () => {
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
          expect(column?.sourceColumns, `${name}.${exposed} keeps reading ${source}`).toEqual([
            source,
          ]);
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
      const columns = byName.get("topics")!.columns.map((column) => column.name);
      expect(columns).toContain("TopicId");
      expect(columns).toContain("TopicName");
      expect(columns).toContain("ParentTopicId");
      expect(columns).toContain("TenantId");
      expect(columns).not.toContain("Centroid");
      expect(columns).not.toContain("EmbeddingsModel");
      expect(columns).not.toContain("P95Distance");
    });
  });

  describe("when a catalogue entry exposes what the builder refuses", () => {
    const projects = LWQL_POSTGRES_CATALOGUE.projects;
    const build = (columns: LwqlTableCatalogue["columns"]) => () =>
      defineCatalogModel({
        name: "projects",
        table: { sourceTable: "Project", columns: { ...projects.columns, ...columns } },
        overrides: LWQL_POSTGRES_ALL_OVERRIDES,
      });

    /** @scenario "A catalogue entry exposing a stripped column fails the build" */
    it("refuses a secret-named field, even renamed", () => {
      expect(build({ apiKey: "inherit" })).toThrow(/exposes "apiKey": secret material/);
      expect(build({ Key: { source: "apiKey" } })).toThrow(/exposes "Key": secret material/);
    });

    it("refuses an entry naming a field the model does not have", () => {
      expect(build({ notARealColumn: "inherit" })).toThrow(/names "notARealColumn"/);
    });

    it("refuses a TenantId that reads anything but the tenant's own field", () => {
      expect(build({ TenantId: { source: "teamId" } })).toThrow(/must declare TenantId/);
    });

    it("refuses a column access the view shape cannot carry yet", () => {
      const access = { allOf: ["project:update"] } as const;
      expect(build({ S3Bucket: { source: "s3Bucket", access } })).toThrow(/only cost:view/);
    });
  });

  describe("when a sensitive column dodges the name rules", () => {
    /** How the derived view treats `source`: recorded as stripped, and whether it is exposed. */
    const strippingOf = ({ baseRelation, source }: { baseRelation: string; source: string }) => {
      const view = byModel.get(baseRelation);
      return {
        column: `${baseRelation}.${source}`,
        derived: view !== undefined,
        recordedAsStripped: view?.skipColumns[source] !== undefined,
        exposed: view?.columns.some((column) => column.sourceColumns.includes(source)) ?? false,
      };
    };
    const stripped = (column: string) => ({
      column,
      derived: true,
      recordedAsStripped: true,
      exposed: false,
    });

    it("strips GithubPullRequest.authorLogin, a raw external-person handle", () => {
      expect(strippingOf({ baseRelation: "GithubPullRequest", source: "authorLogin" })).toEqual(
        stripped("GithubPullRequest.authorLogin"),
      );
    });

    it("strips ModelProvider.customKeys by the plural-key suffix rule", () => {
      const view = byModel.get("ModelProvider")!;
      expect(view.columns.some((column) => column.name === "CustomKeys")).toBe(false);
      expect(view.skipColumns.customKeys).toBeDefined();
    });

    it("strips DiscoveredPerson raw external identity", () => {
      expect(strippingOf({ baseRelation: "DiscoveredPerson", source: "rawActorId" })).toEqual(
        stripped("DiscoveredPerson.rawActorId"),
      );
      expect(strippingOf({ baseRelation: "DiscoveredPerson", source: "displayText" })).toEqual(
        stripped("DiscoveredPerson.displayText"),
      );
    });

    it("strips IngestionSource credential-bearing config", () => {
      expect(strippingOf({ baseRelation: "IngestionSource", source: "parserConfig" })).toEqual(
        stripped("IngestionSource.parserConfig"),
      );
      expect(strippingOf({ baseRelation: "IngestionSource", source: "pollerCursor" })).toEqual(
        stripped("IngestionSource.pollerCursor"),
      );
    });

    it("strips the credential- and identity-bearing bodies the catalogue omits", () => {
      for (const [baseRelation, source] of [
        ["Agent", "config"],
        ["Trigger", "actionParams"],
        ["AnomalyRule", "destinationConfig"],
        ["GithubInstallation", "accountLogin"],
      ] as const) {
        expect(strippingOf({ baseRelation, source })).toEqual(
          stripped(`${baseRelation}.${source}`),
        );
      }
    });

    it("strips ModelProvider.extraHeaders, raw provider auth headers", () => {
      expect(strippingOf({ baseRelation: "ModelProvider", source: "extraHeaders" })).toEqual(
        stripped("ModelProvider.extraHeaders"),
      );
    });
  });

  describe("when a model's own repository enforces per-user visibility", () => {
    const LANGY_MODELS = [
      "LangyConversationProjection",
      "LangyConversationTurnProjection",
      "LangyMessageProjection",
      "LangyTurnRequest",
      "LangyActiveTurn",
    ];

    /** @scenario "Per-user visibility is enforced at the approved view" */
    it("carries a rowFilter referencing the base alias on every Langy view", () => {
      for (const baseRelation of LANGY_MODELS) {
        const view = byModel.get(baseRelation)!;
        expect(view.postgres?.rowFilter, `${baseRelation} should carry a rowFilter`).toBeDefined();
        expect(view.postgres!.rowFilter).toContain('"m".');
      }
    });

    /** @scenario "Per-user visibility is enforced at the approved view" */
    it("renders the rowFilter into the approved view's WHERE clause", () => {
      const statements = postgresViews.approvedViewStatements({
        schema: "public",
      });
      for (const baseRelation of LANGY_MODELS) {
        const view = byModel.get(baseRelation)!;
        const statement = statements.find((entry) =>
          entry.includes(`"${view.postgres!.approvedView}"`),
        );
        expect(statement, `${baseRelation}'s approved-view DO block`).toBeDefined();
        expect(statement).toContain("\nWHERE (");
      }
    });
  });
});
