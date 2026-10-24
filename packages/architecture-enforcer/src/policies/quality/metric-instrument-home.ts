import { basename, join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * ARCHITECTURE.md §17: in a module, a metric instrument is created only in its `*-metrics`
 * service. The oxlint rule `metric-instrument-in-a-service` owns module scope; this owns the
 * "where". Shrink-only baseline in tests/baselines, never read. `packages/` is not read.
 */

export const METRIC_INSTRUMENT_HOME_POLICY = "metric-instrument-home";
export const METRIC_INSTRUMENT_HOME_RATCHET =
  "packages/architecture-enforcer/tests/baselines/metric-instrument-home.json";

const MODULE_TREES = ["modules", "enterprise/modules"] as const;
const GOVERNED = /^(?:enterprise\/)?modules\/[^/]+\/[^/]+\/src\//;
const SOURCE_FILE = /\.[cm]?[jt]sx?$/;
const NOT_PRODUCTION =
  /(?:^|\/)(?:__tests__|__fixtures__|__mocks__|fixtures|e2e|generated)\/|\.(?:test|spec|stories|fixture|generated)\.[cm]?[jt]sx?$/;
/** The `*-metrics` home: any file whose name says it holds metrics. */
const METRICS_HOME = /metrics/i;

const NAMESPACE = "*";
const METER_METHOD = /^create(?:Observable)?(?:Counter|Histogram|Gauge|UpDownCounter)$/;
const FACTORIES = new Set(["counter", "histogram", "gauge", "observableGauge"]);
const FACTORY_SOURCE = /^@langwatch\/observability(?:\/metrics)?$/;
const MIGHT_CREATE =
  /@langwatch\/observability|\bcreate(?:Observable)?(?:Counter|Histogram|Gauge|UpDownCounter)\b/;

type Finding = { file: string; line: number; factory: string };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

/** The value bindings of an import from `@langwatch/observability`, or undefined for any other. */
function factoryImportBindings(statement: ts.Statement): ts.NamedImportBindings | undefined {
  if (!ts.isImportDeclaration(statement)) return undefined;
  if (!ts.isStringLiteral(statement.moduleSpecifier)) return undefined;
  if (!FACTORY_SOURCE.test(statement.moduleSpecifier.text)) return undefined;
  const clause = statement.importClause;
  if (!clause || clause.isTypeOnly) return undefined;

  return clause.namedBindings;
}

function bindNamedFactories({
  named,
  bindings,
}: {
  named: ts.NamedImports;
  bindings: Map<string, string>;
}): void {
  for (const element of named.elements) {
    if (element.isTypeOnly) continue;
    const imported = (element.propertyName ?? element.name).text;
    if (FACTORIES.has(imported)) bindings.set(element.name.text, imported);
  }
}

/**
 * The local names bound to a metric factory, as `local -> factory`; a namespace maps to `*`.
 * Named, renamed and namespace imports count, as in the oxlint rule.
 */
function factoryBindings(source: ts.SourceFile): Map<string, string> {
  const bindings = new Map<string, string>();
  for (const statement of source.statements) {
    const named = factoryImportBindings(statement);
    if (!named) continue;
    if (ts.isNamespaceImport(named)) bindings.set(named.name.text, NAMESPACE);
    else bindNamedFactories({ named, bindings });
  }

  return bindings;
}

/** The factory a call creates an instrument through, or undefined when it creates none. */
function factoryOf({
  callee,
  bindings,
}: {
  callee: ts.Expression;
  bindings: ReadonlyMap<string, string>;
}): string | undefined {
  if (ts.isIdentifier(callee)) {
    const factory = bindings.get(callee.text);

    return factory === NAMESPACE ? undefined : factory;
  }
  if (!ts.isPropertyAccessExpression(callee)) return undefined;
  const method = callee.name.text;
  if (METER_METHOD.test(method)) return method;
  const isNamespace =
    ts.isIdentifier(callee.expression) && bindings.get(callee.expression.text) === NAMESPACE;

  return isNamespace && FACTORIES.has(method) ? method : undefined;
}

function instrumentSites({ file, path }: { file: string; path: string }): Finding[] {
  if (METRICS_HOME.test(basename(path))) return [];
  if (!MIGHT_CREATE.test(sourceText({ file }))) return [];

  const source = sourceFile({ file });
  const bindings = factoryBindings(source);
  const found: Finding[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const factory = factoryOf({ callee: node.expression, bindings });
      if (factory !== undefined) {
        found.push({
          file: path,
          line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
          factory,
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

/** Each metric instrument created in module production code outside a `*metrics*` file. */
export function collectMetricInstrumentsOutsideHome(snapshot: WorkspaceSnapshot): Finding[] {
  const { root } = snapshot;

  return MODULE_TREES.flatMap((directory) =>
    snapshot.files({
      directory: join(root, directory),
      accept: (file) => {
        const path = workspacePath({ root, file });

        return SOURCE_FILE.test(path) && GOVERNED.test(path) && !NOT_PRODUCTION.test(path);
      },
    }),
  ).flatMap((file) => instrumentSites({ file, path: workspacePath({ root, file }) }));
}

/** The shrink-only key: the file. */
export function metricInstrumentHomeKey(finding: Finding): string {
  return finding.file;
}

export function lintMetricInstrumentHome(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectMetricInstrumentsOutsideHome(snapshot).map((finding) => ({
    policy: METRIC_INSTRUMENT_HOME_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.factory,
    message: `\`${finding.factory}(...)\` creates a metric instrument in a file that is not the module's metrics service, so the series has no single owner to find, name or replace in a test.`,
    allowed: `Move the instrument into the module's \`<subject>-metrics.service.ts\` and inject that service where the event happens. Each file's count in ${METRIC_INSTRUMENT_HOME_RATCHET} may fall, never rise: lower it in the change that moves an instrument.`,
  }));
}
