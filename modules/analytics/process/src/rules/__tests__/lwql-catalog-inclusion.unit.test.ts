/** The catalog is opt-in: a table or model is queryable only because the catalog lists it. */

import { describe, expect, it } from "vitest";

import { LangWatchQLCatalogShapesService } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import type { ColumnsManifest } from "../lwql-columns-manifest.rules.ts";
import { defineCatalogTable } from "../lwql-dataset-derivation.rules.ts";
import { defineCatalogModel } from "../lwql-postgres-catalog-model.rules.ts";
import { LWQL_POSTGRES_ALL_OVERRIDES } from "../lwql-postgres-view-catalog.rules.ts";
import type { PrismaManifest } from "../lwql-prisma-schema.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const allowed = new Set(
  LangWatchQLCatalogShapesService.create().allowedTables({
    database: "analytics",
    views: LWQL_VIEW_CATALOG,
  }),
);
const sourceTables = new Set(LWQL_VIEW_CATALOG.map((view) => view.sourceTable));

/** A fake ClickHouse table, well-formed enough that it WOULD build if listed. */
const FAKE_CH_MANIFEST: ColumnsManifest = {
  tables: [
    {
      name: "fake_secret_ledger",
      engine: "ReplacingMergeTree",
      sortingKey: "TenantId, EntryId",
      columns: [
        { name: "TenantId", type: "String", comment: "Project." },
        { name: "EntryId", type: "String", comment: "" },
        { name: "OccurredAt", type: "DateTime64(3)", comment: "" },
      ],
    },
  ],
};

/** A fake tenant-scoped Prisma model, well-formed enough to build if listed. */
const FAKE_PG_MANIFEST: PrismaManifest = {
  enums: [],
  models: [
    {
      name: "FakeSecretModel",
      tableName: "FakeSecretModel",
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
          name: "projectId",
          columnName: "projectId",
          type: "String",
          kind: "scalar",
          isList: false,
          isOptional: false,
          documentation: "",
        },
      ],
    },
  ],
};

describe("the LangWatchQL catalog is opt-in", () => {
  describe("when a ClickHouse table is not listed", () => {
    /** @scenario "A ClickHouse table not listed in the catalog is not queryable" */
    it("has no view and is granted nothing", () => {
      // Real manifest tables the catalog deliberately does not list.
      for (const table of ["instant_eval_runs", "goose_db_version"]) {
        expect(sourceTables.has(table)).toBe(false);
        expect(
          [...allowed].some((entry) => entry.endsWith(`.${table}`)),
          `${table} must not be granted`,
        ).toBe(false);
      }
    });

    /** @scenario "Adding a manifest table without listing it exposes nothing" */
    it("stays off the catalog even when the manifest carries it", () => {
      const before = LWQL_VIEW_CATALOG.length;
      // It WOULD build a view if it were listed — so its absence is opt-in, not
      // a build failure.
      const built = defineCatalogTable(
        "fake_secret_ledger",
        { joinKeys: ["TenantId", "EntryId"] },
        FAKE_CH_MANIFEST,
      );
      expect(built.sourceTable).toBe("fake_secret_ledger");
      // ...yet nothing in the shipped catalog reads it, and the count is fixed.
      expect(sourceTables.has("fake_secret_ledger")).toBe(false);
      expect(LWQL_VIEW_CATALOG.length).toBe(before);
    });
  });

  describe("when a Prisma model is not listed", () => {
    /** @scenario "A Prisma model not listed in the catalog is not queryable" */
    it("has no view and is granted nothing", () => {
      // No catalogued view is backed by these excluded models' base relations —
      // billing/audit/webhook admin data and identity, none of which a project's
      // analytics key may read.
      const baseRelations = new Set(
        LWQL_VIEW_CATALOG.map((view) => view.postgres?.baseRelation).filter(Boolean),
      );
      for (const relation of ["AuditLog", "WebhookEndpoint", "User", "ApiKey"]) {
        expect(baseRelations.has(relation)).toBe(false);
      }
    });

    /** @scenario "Adding a Prisma model without listing it exposes nothing" */
    it("stays off the catalog even when the manifest carries it", () => {
      const before = LWQL_VIEW_CATALOG.length;
      // It WOULD build a view if it were listed.
      const built = defineCatalogModel({
        model: "FakeSecretModel",
        overrides: LWQL_POSTGRES_ALL_OVERRIDES,
        manifest: FAKE_PG_MANIFEST,
      });
      expect(built.postgres?.baseRelation).toBe("FakeSecretModel");
      // ...yet nothing in the shipped catalog reads it, and the count is fixed.
      const baseRelations = new Set(LWQL_VIEW_CATALOG.map((view) => view.postgres?.baseRelation));
      expect(baseRelations.has("FakeSecretModel")).toBe(false);
      expect(LWQL_VIEW_CATALOG.length).toBe(before);
    });
  });

  describe("when the catalogued view names are pinned", () => {
    // The whole public surface: every view name and the table or base relation
    // it reads, in catalog order. Update this list ONLY when adding or removing
    // a view is intended — it is the one place a catalog change is reviewed.
    const PINNED_VIEWS: readonly (readonly [string, string])[] = [
      ["traces", "trace_summaries"],
      ["spans", "stored_spans"],
      ["evaluations", "evaluation_runs"],
      ["simulations", "simulation_runs"],
      ["trace_metrics", "trace_analytics"],
      ["trace_metrics_by_minute", "trace_analytics_rollup"],
      ["model_usage_by_minute", "trace_analytics_rollup"],
      ["evaluation_metrics", "evaluation_analytics"],
      ["evaluation_metrics_by_minute", "evaluation_analytics_rollup"],
      ["coding_sessions", "coding_agent_sessions"],
      ["coding_session_events", "coding_agent_session_events"],
      ["coding_tool_results", "stored_spans"],
      ["judgments", "instant_eval_judgments"],
      ["automation_events", "automation_audit"],
      ["billing_events", "billable_events"],
      ["coding_trace_sessions", "coding_agent_trace_sessions"],
      ["dspy_optimizer_steps", "dspy_steps"],
      ["experiment_items", "experiment_run_items"],
      ["experiment_run_results", "experiment_runs"],
      ["gateway_budget_ledger", "gateway_budget_ledger_events"],
      ["gateway_budget_totals", "gateway_budget_scope_totals"],
      ["gateway_request_spend", "gateway_spend"],
      ["governance_cost_restatements", "governance_cost_rollup_restatement_index"],
      ["governance_daily_cost_rollup", "governance_cost_rollup_1d"],
      ["governance_hourly_kpis", "governance_kpis"],
      ["governance_security_events", "governance_ocsf_events"],
      ["langy_conversation_messages", "langy_messages"],
      ["langy_usage_events", "langy_analytics_events"],
      ["legacy_event_log", "event_log"],
      ["legacy_log_records", "stored_log_records"],
      ["legacy_metric_records", "stored_metric_records"],
      ["log_ingestion_usage", "log_usage_estimates"],
      ["logs", "log_records"],
      ["metric_ingestion_usage", "metric_usage_estimates"],
      ["metric_points", "metric_data_points"],
      ["metric_rollups", "metric_time_rollups"],
      ["metric_series_definitions", "metric_series"],
      ["objects", "stored_objects"],
      ["session_metrics", "session_metric_series"],
      ["simulation_metric_rollups", "simulation_run_metrics_rollup"],
      ["simulation_trace_metrics", "simulation_run_metrics"],
      ["test_suite_runs", "suite_runs"],
      ["agents", "agents_pg"],
      ["ai_tool_entries", "ai_tool_entries_pg"],
      ["ai_tool_entry_departments", "ai_tool_entry_departments_pg"],
      ["ai_tool_entry_teams", "ai_tool_entry_teams_pg"],
      ["analytics", "analytics_pg"],
      ["annotation_queue_items", "annotation_queue_items_pg"],
      ["annotation_queue_scores", "annotation_queue_scores_pg"],
      ["annotation_queues", "annotation_queues_pg"],
      ["annotation_scores", "annotation_scores_pg"],
      ["annotations", "annotations_pg"],
      ["anomaly_alerts", "anomaly_alerts_pg"],
      ["anomaly_rules", "anomaly_rules_pg"],
      ["batch_evaluations", "batch_evaluations_pg"],
      ["costs", "costs_pg"],
      ["custom_graphs", "custom_graphs_pg"],
      ["custom_llm_model_costs", "custom_llm_model_costs_pg"],
      ["dashboards", "dashboards_pg"],
      ["data_privacy_policies", "data_privacy_policies_pg"],
      ["dataset_records", "dataset_records_pg"],
      ["datasets", "datasets_pg"],
      ["department_membership_histories", "department_membership_histories_pg"],
      ["departments", "departments_pg"],
      ["discovered_agents", "discovered_agents_pg"],
      ["discovered_persons", "discovered_persons_pg"],
      ["email_suppressions", "email_suppressions_pg"],
      ["erased_identifier_suppressions", "erased_identifier_suppressions_pg"],
      ["evaluators", "evaluators_pg"],
      ["experiment_versions", "experiment_versions_pg"],
      ["experiments", "experiments_pg"],
      ["gateway_budget_bucket_boundaries", "gateway_budget_bucket_boundaries_pg"],
      ["gateway_budget_ledgers", "gateway_budget_ledgers_pg"],
      ["gateway_budgets", "gateway_budgets_pg"],
      ["gateway_cache_rules", "gateway_cache_rules_pg"],
      ["gateway_change_events", "gateway_change_events_pg"],
      ["gateway_guardrails", "gateway_guardrails_pg"],
      ["gateway_realtime_sessions", "gateway_realtime_sessions_pg"],
      ["github_branch_pull_request_checks", "github_branch_pull_request_checks_pg"],
      ["github_installations", "github_installations_pg"],
      ["github_pull_requests", "github_pull_requests_pg"],
      ["governance_tenant_histories", "governance_tenant_histories_pg"],
      ["identity_match_suggestions", "identity_match_suggestions_pg"],
      ["identity_matches", "identity_matches_pg"],
      ["ingestion_pull_run_projections", "ingestion_pull_run_projections_pg"],
      ["ingestion_sources", "ingestion_sources_pg"],
      ["ingestion_templates", "ingestion_templates_pg"],
      ["langy_active_turns", "langy_active_turns_pg"],
      ["langy_conversation_projections", "langy_conversation_projections_pg"],
      ["langy_conversation_turn_projections", "langy_conversation_turn_projections_pg"],
      ["langy_message_projections", "langy_message_projections_pg"],
      ["langy_turn_requests", "langy_turn_requests_pg"],
      ["model_default_config_scopes", "model_default_config_scopes_pg"],
      ["model_default_configs", "model_default_configs_pg"],
      ["model_provider_scopes", "model_provider_scopes_pg"],
      ["model_providers", "model_providers_pg"],
      ["monitors", "monitors_pg"],
      ["notifications", "notifications_pg"],
      ["pinned_traces", "pinned_traces_pg"],
      ["process_manager_inboxes", "process_manager_inboxes_pg"],
      ["process_manager_instances", "process_manager_instances_pg"],
      ["process_manager_outbox_attempts", "process_manager_outbox_attempts_pg"],
      ["process_manager_outboxes", "process_manager_outboxes_pg"],
      ["projects", "projects_pg"],
      ["prompt_tag_assignments", "prompt_tag_assignments_pg"],
      ["prompt_tags", "prompt_tags_pg"],
      ["prompt_versions", "prompt_versions_pg"],
      ["prompts", "prompts_pg"],
      ["retention_policies", "retention_policies_pg"],
      ["routing_policies", "routing_policies_pg"],
      ["routing_policy_scopes", "routing_policy_scopes_pg"],
      ["saved_views", "saved_views_pg"],
      ["scenario_versions", "scenario_versions_pg"],
      ["scenarios", "scenarios_pg"],
      ["scheduled_jobs", "scheduled_jobs_pg"],
      ["share_links", "share_links_pg"],
      ["simulation_suites", "simulation_suites_pg"],
      ["topic_clustering_run_history_projections", "topic_clustering_run_history_projections_pg"],
      ["topic_clustering_run_projections", "topic_clustering_run_projections_pg"],
      ["topic_model_projections", "topic_model_projections_pg"],
      ["topics", "topics_pg"],
      ["trace_edit_overlays", "trace_edit_overlays_pg"],
      ["trigger_sents", "trigger_sents_pg"],
      ["triggers", "triggers_pg"],
      ["virtual_key_scopes", "virtual_key_scopes_pg"],
      ["virtual_keys", "virtual_keys_pg"],
      ["webhook_endpoint_deliveries", "webhook_endpoint_deliveries_pg"],
      ["workflow_versions", "workflow_versions_pg"],
      ["workflows", "workflows_pg"],
    ];

    /** @scenario "The catalog view names match the pinned list" */
    it("equals the pinned list of 129 views, in order", () => {
      const actual = LWQL_VIEW_CATALOG.map((view) => [view.name, view.sourceTable] as const);
      expect(actual).toEqual(PINNED_VIEWS);
      expect(PINNED_VIEWS).toHaveLength(129);
    });
  });
});
