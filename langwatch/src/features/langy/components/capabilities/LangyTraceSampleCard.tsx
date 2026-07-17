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
import { asJsonDocument, type CliResultDigest } from "@langwatch/cli-cards";
import { Button, Text } from "@chakra-ui/react";
import { ArrowUpRight } from "lucide-react";
import type { ReactNode } from "react";
import {
  useCapabilityData,
  type CapabilityData,
} from "../../hooks/useCapabilityData";
import {
  buildTraceExplorerHref,
  readTraceSearchQuery,
  type TraceSearchQuery,
} from "../../logic/traceExplorerLink";
import type { CapabilityCardInput } from "./capabilityRegistry";
import { collectionOf, textValue, totalOf } from "./cliResultDocument";
import {
  CapabilityRow,
  CapabilityRowSkeletons,
  LangyCapabilityCard,
} from "./LangyCapabilityCard";
import { LangyObservationState } from "../LangyObservationState";
import { LangyContextTarget } from "../LangyContextTarget";
import { traceContextChip } from "../../logic/langyContextChips";

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
  digest,
  projectSlug,
}: CapabilityCardInput) {
  const parsed = parseTraceSearch(output);
  const search = readTraceSearchQuery(input);
  const explorerHref = buildTraceExplorerHref({ projectSlug, search });

  // Hydrate the result's REFERENCES through the product's own API with the
  // viewer's session — the stored output is only the fallback below.
  const hydration = useCapabilityData({
    digest: digest ?? null,
    maxRows: SAMPLE_SIZE,
  });

  if (hydration.status !== "idle") {
    return (
      <HydratedTraceSampleCard
        hydration={hydration}
        digest={digest ?? null}
        search={search}
        explorerHref={explorerHref}
        projectSlug={projectSlug ?? null}
      />
    );
  }

  if (!parsed) {
    // Unreadable output. A confident "0 traces — No traces matched" here would
    // be a wrong answer manufactured out of garbage; say we could not read it
    // and keep the way through to the Explorer, which has the real result.
    return (
      <TraceSampleShell
        title="Traces"
        explorerHref={explorerHref}
        projectSlug={projectSlug ?? null}
      >
        <Text textStyle="xs" color="fg.muted">
          Couldn&apos;t read this result — open the Trace Explorer to see it.
        </Text>
      </TraceSampleShell>
    );
  }

  const { total, traces } = parsed;
  const sample = traces.slice(0, SAMPLE_SIZE);

  return (
    <TraceSampleShell
      title={headline({ total, shown: sample.length })}
      explorerHref={explorerHref}
      projectSlug={projectSlug ?? null}
    >
      {sample.length > 0 ? (
        <>
          {sample.map((trace) => (
            <LangyContextTarget
              key={trace.id}
              target={traceContextChip(trace.id, trace.input)}
            >
              <CapabilityRow
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
            </LangyContextTarget>
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
    </TraceSampleShell>
  );
}

/** The card's one action — through to the Explorer, carrying the query. */
function ExplorerAction({ href }: { href: string | null }) {
  if (!href) return null;
  return (
    <Button
      asChild
      size="xs"
      variant="outline"
      width="full"
      textDecoration="none"
    >
      <a href={href}>
        View in Trace Explorer
        <ArrowUpRight size={12} />
      </a>
    </Button>
  );
}

/** The shared shell every state of this card renders in. */
function TraceSampleShell({
  title,
  explorerHref,
  projectSlug,
  children,
}: {
  title: string;
  explorerHref: string | null;
  projectSlug: string | null;
  children: ReactNode;
}) {
  return (
    <LangyCapabilityCard
      tone="read"
      surface="traces"
      overline="Traces"
      title={title}
      projectSlug={projectSlug}
      // The shell's own chip points at the legacy `/messages` index, which is
      // not where this result lives. The action below goes to the Trace
      // Explorer WITH the query, which is the only link worth offering here.
      deepLink={false}
      actions={
        explorerHref ? <ExplorerAction href={explorerHref} /> : undefined
      }
    >
      {children}
    </LangyCapabilityCard>
  );
}

/**
 * The hydrated card: rows fetched fresh through the product's own API from the
 * result's references, with the viewer's session and permissions. The digest's
 * counts title the card IMMEDIATELY (they are part of the reference), so the
 * card holds its final shape while the rows fill in.
 */
function HydratedTraceSampleCard({
  hydration,
  digest,
  search,
  explorerHref,
  projectSlug,
}: {
  hydration: CapabilityData;
  digest: CliResultDigest | null;
  search: TraceSearchQuery;
  explorerHref: string | null;
  projectSlug: string | null;
}) {
  const returned = digest?.counts?.returned ?? null;
  const total = hydration.totalCount ?? returned;
  const shell = { explorerHref, projectSlug };

  if (hydration.isHydrating && hydration.rows.length === 0) {
    const expected = Math.min(returned ?? SAMPLE_SIZE, SAMPLE_SIZE);
    return (
      <TraceSampleShell
        {...shell}
        title={
          total !== null
            ? headline({ total, shown: Math.min(expected, total) })
            : "Traces"
        }
      >
        <LangyObservationState compact />
        <CapabilityRowSkeletons count={Math.max(expected, 1)} />
      </TraceSampleShell>
    );
  }

  if (hydration.status === "unavailable") {
    return (
      <TraceSampleShell
        {...shell}
        title={total !== null ? headline({ total, shown: 0 }) : "Traces"}
      >
        <Text textStyle="xs" color="fg.muted">
          Couldn&apos;t load these traces right now — open the Trace Explorer to
          see them.
        </Text>
      </TraceSampleShell>
    );
  }

  if (hydration.rows.length === 0) {
    // Hydrated, and none of the referenced traces came back: they are gone —
    // deleted, out of retention, or not visible to this viewer. Say so; never
    // pretend the search matched nothing.
    return (
      <TraceSampleShell
        {...shell}
        title={total !== null ? headline({ total, shown: 0 }) : "Traces"}
      >
        <Text textStyle="xs" color="fg.muted">
          {returned === 1
            ? "This trace is no longer available."
            : "These traces are no longer available."}
        </Text>
      </TraceSampleShell>
    );
  }

  return (
    <TraceSampleShell
      {...shell}
      title={headline({ total, shown: hydration.rows.length })}
    >
      {hydration.rows.map((row) => (
        <LangyContextTarget
          key={row.id}
          target={traceContextChip(row.id, row.primary)}
        >
          <CapabilityRow
            href={
              buildTraceExplorerHref({
                projectSlug,
                search,
                traceId: row.id,
                traceTimestamp: row.timestamp ?? null,
              }) ?? undefined
            }
            primary={row.primary ?? row.id}
            secondary={row.secondary}
          />
        </LangyContextTarget>
      ))}
      {total !== null && total > hydration.rows.length ? (
        <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
          {(total - hydration.rows.length).toLocaleString()} more in the Trace
          Explorer
        </Text>
      ) : null}
    </TraceSampleShell>
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
 * couldn't parse this". NULL is reserved for exactly that miss: output that
 * is not a document we recognise (e.g. JSON truncated upstream). The card
 * must render that as "couldn't read this", never as "0 traces".
 */
function parseTraceSearch(output: unknown): {
  total: number | null;
  traces: SampledTrace[];
} | null {
  const document = asJsonDocument(output);
  const rows = document ? collectionOf(document) : null;
  if (!rows) return null;

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
