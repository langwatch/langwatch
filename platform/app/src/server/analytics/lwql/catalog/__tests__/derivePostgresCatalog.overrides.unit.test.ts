/**
 * The Postgres catalog derivation's override handling: the six
 * formerly-hand-written views, topic clustering internals, re-admit reasons,
 * name-rule-dodging columns and the skip-list guard.
 *
 * Split out of `./derivePostgresCatalog.unit.test.ts` (which covers naming,
 * tenant scope and safe defaults) to keep each file under the repo's per-file
 * line budget for new test files.
 *
 * @see ../derivePostgresCatalog.ts — the code under test
 * @see specs/lwql/postgres-catalog.feature
 */

import { describe, expect, it } from "vitest";
import { lwqlPostgresApprovedViewStatements } from "../../provisioning/catalogStatements";
import {
  derivePostgresCatalog,
  type PostgresDatasetOverride,
} from "../derivePostgresCatalog";
import {
  assertPostgresSkipReasons,
  LWQL_POSTGRES_SKIPPED_MODELS,
  POSTGRES_SKIP_REASON_PREFIXES,
} from "../postgresSkippedModels";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../postgresViews";
import { LWQL_PRISMA_MANIFEST } from "../prismaManifest";

const catalog = derivePostgresCatalog({
  manifest: LWQL_PRISMA_MANIFEST,
  skip: LWQL_POSTGRES_SKIPPED_MODELS,
  overrides: LWQL_POSTGRES_ALL_OVERRIDES,
});
const byModel = new Map(
  catalog.map((view) => [view.postgres!.baseRelation, view]),
);
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

    it("refuses a skipColumns entry naming a column the model does not have", () => {
      const badOverride: Record<string, PostgresDatasetOverride> = {
        Annotation: { skipColumns: { notARealColumn: "made up" } },
      };
      expect(() =>
        derivePostgresCatalog({
          manifest: LWQL_PRISMA_MANIFEST,
          skip: LWQL_POSTGRES_SKIPPED_MODELS,
          overrides: { ...LWQL_POSTGRES_ALL_OVERRIDES, ...badOverride },
        }),
      ).toThrow(/skipColumns names "notARealColumn"/);
    });
  });

  describe("when a sensitive column dodges the name rules", () => {
    const assertStripped = ({
      baseRelation,
      source,
    }: {
      baseRelation: string;
      source: string;
    }) => {
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

    it("strips GithubPullRequest.authorLogin, a raw external-person handle", () => {
      assertStripped({
        baseRelation: "GithubPullRequest",
        source: "authorLogin",
      });
    });

    it("strips ModelProvider.customKeys by the plural-key suffix rule", () => {
      const view = byModel.get("ModelProvider")!;
      expect(view.columns.some((column) => column.name === "CustomKeys")).toBe(
        false,
      );
      expect(view.skipColumns.customKeys).toBeDefined();
    });

    it("strips DiscoveredPerson raw external identity", () => {
      assertStripped({
        baseRelation: "DiscoveredPerson",
        source: "rawActorId",
      });
      assertStripped({
        baseRelation: "DiscoveredPerson",
        source: "displayText",
      });
    });

    it("strips IngestionSource credential-bearing config", () => {
      assertStripped({
        baseRelation: "IngestionSource",
        source: "parserConfig",
      });
      assertStripped({
        baseRelation: "IngestionSource",
        source: "pollerCursor",
      });
    });

    it("strips ModelProvider.extraHeaders, raw provider auth headers", () => {
      assertStripped({
        baseRelation: "ModelProvider",
        source: "extraHeaders",
      });
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
        expect(
          view.postgres?.rowFilter,
          `${baseRelation} should carry a rowFilter`,
        ).toBeDefined();
        expect(view.postgres!.rowFilter).toContain('"m".');
      }
    });

    /** @scenario "Per-user visibility is enforced at the approved view" */
    it("renders the rowFilter into the approved view's WHERE clause", () => {
      const statements = lwqlPostgresApprovedViewStatements({
        schema: "public",
      });
      for (const baseRelation of LANGY_MODELS) {
        const view = byModel.get(baseRelation)!;
        const statement = statements.find((entry) =>
          entry.includes(`"${view.postgres!.approvedView}"`),
        );
        expect(
          statement,
          `${baseRelation}'s approved-view DO block`,
        ).toBeDefined();
        expect(statement).toContain("\nWHERE (");
      }
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
