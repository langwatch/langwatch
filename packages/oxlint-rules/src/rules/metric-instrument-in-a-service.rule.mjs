import { defineRule } from "../define-rule.mjs";

// An instrument is made by an injected `*-metrics` service naming the series
// `langwatch_<module>_<what>_<unit>`, never at module scope, where every importer shares one hidden
// global. Refused in module code: a module-scope instrument from the observability factories (any
// import form) or a meter's `create*`, and an unprefixed series. Which file creates it is the
// enforcer's `metric-instrument-home` policy (it holds a shrink list); neither governs packages/.

const NAMESPACE = "*";
const METER_METHOD = /^create(?:Observable)?(?:Counter|Histogram|Gauge|UpDownCounter)$/;
const FACTORIES = new Set(["counter", "histogram", "gauge", "observableGauge"]);
const FACTORY_SOURCE = /^@langwatch\/observability(?:\/metrics)?$/;
const NAME_PREFIX = "langwatch_";

// Series published before the prefix rule. Their names are keyed by
// HISTOGRAM_BOUNDARIES, documented for self-hosters and read by dashboards and
// alerts, so renaming one is a migration of its own, not a lint fix. A new
// series never joins this set.
const LEGACY_METRIC_NAMES = new Set([
  "automation_auto_paused_total",
  "automation_ceiling_breach_total",
  "automation_containment_failed_total",
  "automation_match_records_total",
  "automation_overflow_flush_total",
  "evaluation_duration_milliseconds",
  "evaluation_status_counter",
  "ingestion_pull_duration_milliseconds",
  "ingestion_pull_total",
  "insight_daily_run_duration_milliseconds",
  "insight_daily_run_total",
  "payload_size_bytes",
  "pii_checks",
  "topic_clustering_page_duration_milliseconds",
  "topic_clustering_page_total",
  "trace_ingestion_spans_total",
  "job_processing_counter",
  "job_processing_duration_milliseconds",
  "identity_projection_convergence_timeouts_total",
  "identity_commit_duration_seconds",
  "coding_agent_cost_computed_usd_total",
  "coding_agent_cost_reported_usd_total",
  "clickhouse_table_rows",
  "clickhouse_table_bytes",
  "clickhouse_table_parts",
  "clickhouse_disk_total_bytes",
  "clickhouse_disk_used_bytes",
  "clickhouse_disk_free_bytes",
  "clickhouse_backup_status_total",
  "clickhouse_backup_last_success_timestamp_seconds",
  "clickhouse_backup_last_size_bytes",
  "authz_engine_gate_read_failures_total",
  "stored_object_read_failures_total",
]);

const FUNCTION_NODES = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];

/** Whether a statement is a value import from the observability metric factories. */
function isFactoryImport(statement) {
  if (statement.type !== "ImportDeclaration" || statement.importKind === "type") return false;

  return FACTORY_SOURCE.test(statement.source?.value ?? "");
}

/** The factory one import specifier binds: `*` for a namespace, else a factory name, if any. */
function factoryBoundBy(specifier) {
  if (specifier.type === "ImportNamespaceSpecifier") return NAMESPACE;
  if (specifier.type !== "ImportSpecifier" || specifier.importKind === "type") return undefined;
  const imported = specifier.imported?.name ?? specifier.imported?.value;

  return FACTORIES.has(imported) ? imported : undefined;
}

/** The local names bound to a metric factory, as `local -> factory`; a namespace maps to `*`. */
function factoryBindingsOf(program) {
  const bindings = new Map();
  for (const statement of program.body.filter(isFactoryImport)) {
    for (const specifier of statement.specifiers ?? []) {
      const factory = factoryBoundBy(specifier);
      if (factory) bindings.set(specifier.local.name, factory);
    }
  }

  return bindings;
}

/**
 * The factory a call creates an instrument through: an imported factory, a factory read off a
 * namespace import (`metrics.counter`), or an OpenTelemetry meter method (`createCounter`).
 */
function factoryOf(callee, bindings) {
  if (callee?.type === "Identifier") {
    const factory = bindings.get(callee.name);

    return factory === NAMESPACE ? undefined : factory;
  }
  if (callee?.type !== "MemberExpression" || callee.computed) return undefined;
  const method = callee.property?.name;
  if (METER_METHOD.test(method ?? "")) return method;
  const isNamespace =
    callee.object?.type === "Identifier" && bindings.get(callee.object.name) === NAMESPACE;

  return isNamespace && FACTORIES.has(method) ? method : undefined;
}

/** Module-scope `const NAME = "literal"`, so a named constant still shows its series name. */
function stringConstantsOf(program) {
  const constants = new Map();
  for (const statement of program.body) {
    const declaration =
      statement.type === "ExportNamedDeclaration" ? statement.declaration : statement;
    if (declaration?.type !== "VariableDeclaration" || declaration.kind !== "const") continue;
    for (const declarator of declaration.declarations) {
      if (declarator.id?.type === "Identifier" && typeof declarator.init?.value === "string") {
        constants.set(declarator.id.name, declarator.init.value);
      }
    }
  }

  return constants;
}

function nameOf({ definition, constants }) {
  if (definition?.type !== "ObjectExpression") return undefined;
  const property = definition.properties.find(
    (candidate) =>
      candidate.type === "Property" &&
      !candidate.computed &&
      (candidate.key?.name === "name" || candidate.key?.value === "name"),
  );
  const value = property?.value;
  if (value?.type === "Literal" && typeof value.value === "string") return value.value;
  if (value?.type === "Identifier") return constants.get(value.name);

  return undefined;
}

export const metricInstrumentInAServiceRule = defineRule({
  name: "metric-instrument-in-a-service",
  kind: "problem",
  applies: (file) => file.isProduction && Boolean(file.module),
  messages: {
    instrumentAtModuleScope: {
      what: "`{{factory}}(...)` creates a metric instrument at module scope.",
      why: "A module-scope instrument is a hidden global every importer shares and no test can replace.",
      fix: "Create it in an injected `<subject>-metrics.service.ts` class (a field or its constructor) and call that service where the event happens. Read the `process-module` skill.",
    },
    seriesNeedsPrefix: {
      what: "The metric `{{name}}` does not start with `langwatch_`.",
      why: "One prefix lets a collector select every series the platform emits without listing names.",
      fix: "Name it `langwatch_<module>_<what>_<unit>`. A series that dashboards already read keeps its name and is listed in LEGACY_METRIC_NAMES with the reason. Read the `process-module` skill.",
    },
  },
  create(context) {
    let bindings = new Map();
    let constants = new Map();
    let depth = 0;
    const enter = () => {
      depth += 1;
    };
    const leave = () => {
      depth -= 1;
    };

    const visitors = {
      Program(node) {
        bindings = factoryBindingsOf(node);
        constants = stringConstantsOf(node);
      },
      ClassBody: enter,
      "ClassBody:exit": leave,
      CallExpression(node) {
        const factory = factoryOf(node.callee, bindings);
        if (!factory) return;
        if (depth === 0) {
          context.report({ node, messageId: "instrumentAtModuleScope", data: { factory } });
        }
        const name = nameOf({ definition: node.arguments[0], constants });
        if (name && !name.startsWith(NAME_PREFIX) && !LEGACY_METRIC_NAMES.has(name)) {
          context.report({ node, messageId: "seriesNeedsPrefix", data: { name } });
        }
      },
    };
    for (const type of FUNCTION_NODES) {
      visitors[type] = enter;
      visitors[`${type}:exit`] = leave;
    }

    return visitors;
  },
});
