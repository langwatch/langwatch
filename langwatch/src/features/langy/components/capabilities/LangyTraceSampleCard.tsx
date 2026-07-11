/**
 * Trace-sample card (`langwatch.trace.search`).
 *
 * Langy finding 34 traces and telling you so is not the same as showing you
 * any of them. This card closes that gap: it renders a SAMPLE of the matched
 * traces, each one clickable through to its drawer, plus a way into the full
 * result set in the Trace Explorer.
 *
 * Two rules it holds to:
 *
 *   THE SAMPLE NEVER PRETENDS TO BE THE RESULT. The CLI returns up to `--limit`
 *   traces (25 by default), and 25 traces down a chat column is a wall nobody
 *   reads. So it shows three, and it says so — "34 traces · showing 3". The
 *   count comes from the result's own `pagination.totalHits`, not from the
 *   length of the array we happen to be holding, which is a different number
 *   and the source of the lie we are avoiding.
 *
 *   THE WAY OUT LANDS ON THE SAME QUESTION. "View in Trace Explorer" carries the
 *   agent's actual query — the free text and the exact time window — into the
 *   Explorer's URL. See `logic/traceExplorerLink.ts` for how the CLI's grammar
 *   maps onto the Explorer's, and for the one dimension (`--limit`) that has
 *   nowhere to go in that URL.
 *
 * The rows lead with what the Trace Explorer's own table leads with — when it
 * ran, what went in, how long it took, what it cost, whether it failed — so the
 * card and the table read as the same product rather than two different tools
 * that happen to both know about traces.
 *
 * Visually this is nothing but the existing kit: `LangyCapabilityCard` for the
 * chrome, `CapabilityRow` for the rows. It deliberately introduces no styling of
 * its own, so whatever the card shell becomes, this follows.
 */
import { asJsonDocument } from "@langwatch/cli-cards";
import { Button, HStack, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import {
  buildTraceExplorerHref,
  readTraceSearchQuery,
} from "../../logic/traceExplorerLink";
import type { CapabilityCardInput } from "./capabilityRegistry";
import { collectionOf, textValue, totalOf } from "./cliResultDocument";
import { CapabilityRow, LangyCapabilityCard } from "./LangyCapabilityCard";

/**
 * How many traces the card shows. Three is enough to recognise a pattern ("they
 * all failed on the same input") and few enough to stay a card rather than
 * becoming a table.
 */
const SAMPLE_SIZE = 3;

const PREVIEW_MAX = 90;

interface SampledTrace {
  id: string;
  startedAt?: number;
  input?: string;
  output?: string;
  latencyMs?: number;
  cost?: number;
  isError: boolean;
}

export function LangyTraceSampleCard({
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const { total, traces } = parseTraceSearch(output);
  const search = readTraceSearchQuery(input);
  const sample = traces.slice(0, SAMPLE_SIZE);

  const explorerHref = buildTraceExplorerHref({ projectSlug, search });

  return (
    <LangyCapabilityCard
      tone="read"
      surface="traces"
      overline="Traces"
      title={headline({ total, shown: sample.length })}
      projectSlug={projectSlug}
      // The shell's own chip points at the legacy `/messages` index, which is
      // not where this result lives. The action below goes to the Trace
      // Explorer WITH the query, which is the only link worth offering here.
      deepLink={false}
      actions={
        explorerHref ? (
          <Button
            asChild
            size="xs"
            variant="outline"
            width="full"
            textDecoration="none"
          >
            <a href={explorerHref}>
              View in Trace Explorer
              <ArrowUpRight size={12} />
            </a>
          </Button>
        ) : undefined
      }
    >
      {sample.length > 0 ? (
        <>
          {sample.map((trace) => (
            <CapabilityRow
              key={trace.id}
              // Straight to the trace's drawer — the same URL-routed drawer the
              // trace table opens, so a row here and a row there land in the
              // identical place. The search rides along, so closing the drawer
              // leaves the right result set behind it.
              href={
                buildTraceExplorerHref({
                  projectSlug,
                  search,
                  traceId: trace.id,
                  traceTimestamp: trace.startedAt,
                }) ?? undefined
              }
              primary={trace.input ?? trace.id}
              secondary={metaLine(trace)}
            />
          ))}
          {total !== null && total > sample.length ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
              {(total - sample.length).toLocaleString()} more in the Trace
              Explorer
            </Text>
          ) : null}
        </>
      ) : (
        <Text textStyle="xs" color="fg.muted">
          No traces matched.
        </Text>
      )}
    </LangyCapabilityCard>
  );
}

/**
 * "34 traces · showing 3". Never lets the sample masquerade as the whole result:
 * the qualifier only disappears when the sample IS the whole result.
 */
function headline({
  total,
  shown,
}: {
  total: number | null;
  shown: number;
}): string {
  if (total === null) {
    return `${shown} ${shown === 1 ? "trace" : "traces"}`;
  }
  const found = `${total.toLocaleString()} ${total === 1 ? "trace" : "traces"}`;
  return total > shown ? `${found} · showing ${shown}` : found;
}

/** `2 Jul 14:03 · 1.2s · $0.0041 · failed` — only the parts we actually know. */
function metaLine(trace: SampledTrace): string {
  const parts: string[] = [];
  if (trace.startedAt !== undefined) parts.push(formatWhen(trace.startedAt));
  if (trace.latencyMs !== undefined) parts.push(formatLatency(trace.latencyMs));
  if (trace.cost !== undefined) parts.push(formatCost(trace.cost));
  if (trace.isError) parts.push("failed");
  else if (trace.output) parts.push(trace.output);
  return parts.join(" · ");
}

function formatWhen(startedAt: number): string {
  return new Date(startedAt).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatLatency(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatCost(cost: number): string {
  // Sub-cent costs are the norm for a single trace, so two decimals would round
  // almost every trace to "$0.00" and tell the reader nothing.
  return cost < 0.01 ? `$${cost.toFixed(4)}` : `$${cost.toFixed(2)}`;
}

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** A trace row's id, however the API spelled it. */
function traceIdOf(row: Record<string, unknown>): string | null {
  for (const key of ["trace_id", "traceId", "id"]) {
    const value = row[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

function numberAt(source: unknown, key: string): number | undefined {
  if (!source || typeof source !== "object") return undefined;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * The CLI runs its reads with `--format json`, so what lands here is the
 * structured document (`{ traces: [...], pagination: { totalHits } }`).
 *
 * An EMPTY list is a real answer ("nothing matched"), not a miss — hence
 * `{ traces: [] }` with a total, rather than a null that would read as "we
 * couldn't parse this".
 */
function parseTraceSearch(output: unknown): {
  total: number | null;
  traces: SampledTrace[];
} {
  const document = asJsonDocument(output);
  const rows = document ? collectionOf(document) : null;
  if (!rows) return { total: null, traces: [] };

  const traces: SampledTrace[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const record = row as Record<string, unknown>;

    const id = traceIdOf(record);
    if (!id) continue;

    const inputText = textValue(record.input);
    const outputText = textValue(record.output);
    const error = record.error;

    traces.push({
      id,
      startedAt: numberAt(record.timestamps, "started_at"),
      latencyMs: numberAt(record.metrics, "total_time_ms"),
      cost: numberAt(record.metrics, "total_cost"),
      isError: !!error,
      ...(inputText ? { input: truncate(inputText, PREVIEW_MAX) } : {}),
      ...(outputText ? { output: truncate(outputText, PREVIEW_MAX) } : {}),
    });
  }

  // `totalHits` is the honest count — the array is only what `--limit` let
  // through. Falling back to the array length is a last resort, not the default.
  return { total: totalOf(document) ?? traces.length, traces };
}
