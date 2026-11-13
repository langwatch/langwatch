import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import {
  type Access,
  type ClickhouseScan,
  clickhouseScanOf,
} from "./clickhouse-table-ownership.ts";

/**
 * ADR-201 v1.10: a module statement reading span content carries an `AuthorizedClickHouse` marker,
 * never a tenant predicate of its own. A read past the fence is a named bypass with its reason; a
 * stale bypass is reported so the list cannot widen.
 */

const POLICY = "span-table-fence";

/** The tables holding span content: span attributes, inputs and outputs (migration 00002). */
export const SPAN_CONTENT_TABLES: ReadonlySet<string> = new Set([
  "stored_spans",
  "trace_summaries",
]);

/** A fence marker as a repository writes it: the marker helper's call, or its expanded text. */
const FENCE_MARKER =
  /\btenantScope(?:WithConditions|ForLatestVersion)?\s*\(|\btenantSet\s*\(|\{\{tenant(?:Scope|Set)\b/;

/** Mirrors `HAND_WRITTEN_TENANT_PREDICATE` in clickhouse-client's authorized-reads.ts. */
const HAND_WRITTEN_TENANT_PREDICATE =
  /\bTenantId\s*(?:=(?!\s*(?:[A-Za-z_]\w*\.)?TenantId\b)|!=|<>|<=|>=|<|>|(?:NOT\s+)?IN\b|(?:NOT\s+)?LIKE\b)/i;

const INTERPOLATION = /\$\{/;
const INTERPOLATED = /\$\{[^{}]*\}/g;

const ALLOWED =
  "Read span tables through AuthorizedClickHouse.as(authorization, { reads }) with a tenantScope marker; name a system read in FENCE_BYPASSES with its reason. See ADR-201 §3.";

/** A module read of a span table that does not go through the fence, and why it may not. */
export type FenceBypass = { module: string; table: string; file: string; reason: string };

const TRACE_REPOSITORIES = "modules/trace/process/src/repositories/clickhouse";
const LEGACY_READ =
  "modules/trace/process/src/features/legacy/repositories/clickhouse/trace-legacy-read.repository.ts";
const LEGACY_REASON =
  "the pre-proof list, search and prompt-studio reads of one project id; no shared or braided project is read, so braids fail closed here until the legacy reads move onto the fence";
const FULL_RECORD_REASON =
  "the internal full read of one project's trace by its own id (internal protections); no shared or braided project is read";
const EXISTENCE_REASON =
  "set membership and cost by trace id inside one project, for ingestion and evaluation; returns ids and totals, no span content";

/** Each read past the fence today, by module, table and file (ADR-201 v1.10). */
export const FENCE_BYPASSES: readonly FenceBypass[] = [
  {
    module: "evaluation",
    table: "trace_summaries",
    file: "modules/evaluation/process/src/repositories/clickhouse/monitor-performance.repository.ts",
    reason:
      "dates one project's evaluation runs by its own traces' OccurredAt; reads no span content",
  },
  { module: "trace", table: "stored_spans", file: LEGACY_READ, reason: LEGACY_REASON },
  { module: "trace", table: "trace_summaries", file: LEGACY_READ, reason: LEGACY_REASON },
  {
    module: "trace",
    table: "trace_summaries",
    file: `${TRACE_REPOSITORIES}/clickhouse.trace-attributed-rollup.repository.ts`,
    reason:
      "the governance activity monitor's spend rollups of one project: cost, counts and attribute groups, no span content",
  },
  {
    module: "trace",
    table: "trace_summaries",
    file: `${TRACE_REPOSITORIES}/clickhouse.trace-clustering-sample.repository.ts`,
    reason:
      "topic clustering's background sample of one project's own traces; a system read no route proof covers",
  },
  {
    module: "trace",
    table: "trace_summaries",
    file: `${TRACE_REPOSITORIES}/clickhouse.trace-model-spend.repository.ts`,
    reason: "personal usage spend of one project: cost and token totals by model, no span content",
  },
  {
    module: "trace",
    table: "stored_spans",
    file: `${TRACE_REPOSITORIES}/trace-derivation-span.repository.ts`,
    reason:
      "the worker's trace derivation reads the own project's spans to derive its events; a system read no route proof covers",
  },
  {
    module: "trace",
    table: "stored_spans",
    file: `${TRACE_REPOSITORIES}/trace-existence.repository.ts`,
    reason: EXISTENCE_REASON,
  },
  {
    module: "trace",
    table: "trace_summaries",
    file: `${TRACE_REPOSITORIES}/trace-existence.repository.ts`,
    reason: EXISTENCE_REASON,
  },
  {
    module: "trace",
    table: "stored_spans",
    file: `${TRACE_REPOSITORIES}/trace-full-record.repository.ts`,
    reason: FULL_RECORD_REASON,
  },
  {
    module: "trace",
    table: "trace_summaries",
    file: `${TRACE_REPOSITORIES}/trace-full-record.repository.ts`,
    reason: FULL_RECORD_REASON,
  },
  {
    module: "trace",
    table: "trace_summaries",
    file: `${TRACE_REPOSITORIES}/trace-usage-count.repository.ts`,
    reason:
      "per-project trace counts for usage and limits; a system read of ids and counts, no span content",
  },
];

type Finding = { key: string; file: string; line?: number; message: string };

/** The literal a read access was found in: the longest string or template starting on its line. */
function statementAt({ source, line }: { source: ts.SourceFile; line: number }): string {
  let statement = "";
  const visit = (node: ts.Node): void => {
    const literal = ts.isStringLiteralLike(node) || ts.isTemplateExpression(node);
    const start = node.getStart(source);
    if (literal && source.getLineAndCharacterOfPosition(start).line + 1 === line) {
      const text = node.getText(source);
      if (text.length > statement.length) statement = text;
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return statement;
}

/** Why a span-table read breaks the fence, or undefined when it holds. */
export function fenceBreachOf(statement: string): string | undefined {
  // An interpolation reads as a name, so a join key `${a}.TenantId = ${b}.TenantId` passes.
  const bare = statement.replace(INTERPOLATED, "x");
  if (HAND_WRITTEN_TENANT_PREDICATE.test(bare)) return "spells its own tenant predicate";
  if (FENCE_MARKER.test(statement) || INTERPOLATION.test(statement)) return void 0;

  return "carries no fence marker";
}

const bypassKey = (item: Pick<FenceBypass, "module" | "table" | "file">): string =>
  `${item.module}|${item.table}|${item.file}`;

function spanReads(scan: ClickhouseScan): Access[] {
  return scan.access.filter((entry) => !entry.write && SPAN_CONTENT_TABLES.has(entry.table));
}

/** Every read that breaks the fence and no bypass names, and every bypass naming no read. */
export function collectSpanTableFenceFindings({
  scan,
  root,
  bypasses = FENCE_BYPASSES,
}: {
  scan: ClickhouseScan;
  root: string;
  bypasses?: readonly FenceBypass[];
}): Finding[] {
  const reads = spanReads(scan);
  const named = new Set(bypasses.map(bypassKey));
  const findings = new Map<string, Finding>();
  const seen = new Set<string>();

  for (const entry of reads) {
    const file = relative(root, entry.file);
    const key = bypassKey({ module: entry.module, table: entry.table, file });
    seen.add(key);
    if (named.has(key)) continue;
    const breach = fenceBreachOf(
      statementAt({ source: sourceFile({ file: entry.file }), line: entry.line }),
    );
    if (breach === undefined) continue;
    findings.set(`${key}|${entry.line}`, {
      key,
      file: entry.file,
      line: entry.line,
      message: `${entry.module} reads ${entry.table} in a statement that ${breach}, bypassing the fence.`,
    });
  }

  for (const item of bypasses.filter((bypass) => !seen.has(bypassKey(bypass)))) {
    findings.set(`stale|${bypassKey(item)}`, {
      key: bypassKey(item),
      file: join(root, item.file),
      message: `The fence bypass for ${item.module} reading ${item.table} in ${item.file} matches no read. Delete it.`,
    });
  }

  return [...findings.values()];
}

/** The registry entry: a span-table read past the fence, or a stale bypass, is a violation. */
export function lintSpanTableFence(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const scan = clickhouseScanOf(snapshot);
  if (scan.tables.size === 0) return [];

  return collectSpanTableFenceFindings({ scan, root: snapshot.root }).map((finding) => ({
    policy: POLICY,
    file: finding.file,
    line: finding.line,
    message: finding.message,
    allowed: ALLOWED,
  }));
}
