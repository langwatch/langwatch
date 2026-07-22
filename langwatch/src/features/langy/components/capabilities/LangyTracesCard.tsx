/**
 * Traces capability card (`langwatch.trace.search` / `langwatch.trace.get`).
 *
 * A trace search renders a row list — one row per matched trace, each linking
 * to that trace — under a "Found N traces" header. A single-trace lookup
 * renders a one-trace summary. Both are reads: no Apply, just the results and
 * the "Open in Traces" deep link.
 *
 * The CLI runs its reads with `--format json`, so what lands here is the
 * structured document (`{ traces: [...], pagination: { totalHits } }`), read
 * through `cliResultDocument`. The markdown-digest parse below it is the older
 * MCP transport's shape, kept so a conversation recorded under it still replays.
 */
import { Button, Text, VStack } from "@chakra-ui/react";
import { Search } from "lucide-react";
import { useRouter } from "~/utils/compat/next-router";
import {
  buildTraceExplorerHref,
  readTraceSearchQuery,
} from "../../logic/traceExplorerLink";
import {
  buildSurfaceHref,
  extractPrimaryId,
  extractToolText,
  summaryLines,
  type CapabilityCardInput,
} from "./capabilityRegistry";
// `asJsonDocument` is the shared CLI contract's, not the panel's — the CLI and the
// panel agree on what a result document IS in exactly one place.
import { asJsonDocument } from "@langwatch/cli-cards";
import { collectionOf, textValue, totalOf } from "./cliResultDocument";
import { CapabilityRow, LangyCapabilityCard } from "./LangyCapabilityCard";

interface ParsedTrace {
  id: string;
  snippet?: string;
}

const SNIPPET_MAX = 120;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

/** A trace row's id, however the API spelled it. */
function traceIdOf(row: unknown): string | null {
  if (!row || typeof row !== "object") return null;
  const record = row as Record<string, unknown>;
  for (const key of ["trace_id", "traceId", "id"]) {
    const value = record[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

/**
 * The CLI's trace-search document. Null when the output is not one, so the
 * caller falls back to the digest parse. An EMPTY list is a real answer
 * ("nothing matched"), not a miss — which is why this returns `{ traces: [] }`
 * rather than null in that case.
 */
function parseTracesJson(
  output: unknown,
): { total: number | null; traces: ParsedTrace[] } | null {
  const document = asJsonDocument(output);
  if (!document) return null;

  const rows = collectionOf(document);
  if (!rows) return null;

  const traces: ParsedTrace[] = [];
  for (const row of rows) {
    const id = traceIdOf(row);
    if (!id) continue;
    const snippet = textValue((row as Record<string, unknown>).input);
    traces.push({
      id,
      ...(snippet ? { snippet: truncate(snippet, SNIPPET_MAX) } : {}),
    });
  }

  return { total: totalOf(document) ?? traces.length, traces };
}

/** The lines a single-trace document is worth summarising with. */
function singleTraceLines(output: unknown): string[] | null {
  const document = asJsonDocument(output);
  if (!document || !traceIdOf(document)) return null;

  const record = document as Record<string, unknown>;
  const error = record.error;
  const errorMessage =
    error && typeof error === "object"
      ? textValue((error as { message?: unknown }).message)
      : textValue(error);

  const lines = [
    textValue(record.input),
    textValue(record.output),
    errorMessage,
  ]
    .filter((line): line is string => !!line)
    .map((line) => truncate(line, SNIPPET_MAX * 2));

  return lines.length > 0 ? lines : null;
}

/**
 * Null means UNREADABLE — neither the JSON contract nor the legacy markdown
 * digest recognised the output (e.g. JSON truncated upstream). That is a
 * different thing from an EMPTY result, and the caller must render it
 * differently: "couldn't read this" is honest; "0 traces matched" would be a
 * confident wrong answer manufactured out of garbage.
 */
function parseTraces(output: unknown): {
  total: number | null;
  traces: ParsedTrace[];
} | null {
  const structured = parseTracesJson(output);
  if (structured) return structured;

  const text = extractToolText(output);
  const totalMatch = text.match(/Found\s+([\d,]+)\s+traces/i);
  const total = totalMatch ? Number(totalMatch[1]!.replace(/,/g, "")) : null;

  const traces: ParsedTrace[] = [];
  const blocks = text.split(/^###\s+Trace:\s*/m).slice(1);
  for (const block of blocks) {
    const idMatch = block.match(/^([A-Za-z0-9_-]+)/);
    if (!idMatch) continue;
    const id = idMatch[1]!;
    const inputLine = block.match(/\*\*Input\*\*:\s*(.+)/);
    const snippet = inputLine ? inputLine[1]!.trim() : undefined;
    traces.push({ id, snippet });
  }
  // The digest found neither a count nor a single trace: this is not a result
  // we understood. (A real "Found 0 traces" digest lands above with total=0.)
  if (total == null && traces.length === 0) return null;
  return { total, traces };
}

export function LangyTracesCard({
  descriptor,
  input,
  output,
  projectSlug,
}: CapabilityCardInput) {
  const isSingle = descriptor.render === "trace";
  // The search Langy actually ran, offered back as somewhere to GO.
  //
  // `logic/traceExplorerLink` owns this, and reusing it is not tidiness: the
  // CLI's `--query` is FREE TEXT while the Explorer's `q` is a liqe expression,
  // so an unquoted `status:error` silently stops being a text search and
  // becomes a field filter — the user lands on a different result set than the
  // card just showed them. That module quotes the term and carries the time
  // window; a local copy of it did neither.
  const router = useRouter();
  const search = readTraceSearchQuery(input);
  const queryHref = search.query
    ? buildTraceExplorerHref({ projectSlug, search })
    : null;

  if (isSingle) {
    const id = extractPrimaryId(input, output);
    const lines = singleTraceLines(output) ?? summaryLines(output, 4);
    return (
      <LangyCapabilityCard
        tone="read"
        surface="traces"
        overline="Trace"
        title={id ? `Trace ${id.slice(0, 10)}` : "Trace"}
        projectSlug={projectSlug}
        resourceId={id}
      >
        {lines.length > 0 ? (
          <VStack align="stretch" gap={0.5}>
            {lines.map((line, i) => (
              <Text key={i} textStyle="xs" color="fg.muted" lineHeight="1.45">
                {line}
              </Text>
            ))}
          </VStack>
        ) : null}
      </LangyCapabilityCard>
    );
  }

  const parsed = parseTraces(output);
  if (!parsed) {
    // Unreadable output must NEVER render as a definitive empty result. Own
    // the failure and point at the surface that has the real answer.
    return (
      <LangyCapabilityCard
        tone="read"
        surface="traces"
        overline="Traces"
        title="Traces"
        projectSlug={projectSlug}
      >
        <Text textStyle="xs" color="fg.muted">
          Couldn&apos;t read this result. Open Traces to see it.
        </Text>
      </LangyCapabilityCard>
    );
  }

  const { total, traces } = parsed;
  const shown = traces.slice(0, 6);
  const remaining = (total ?? traces.length) - shown.length;

  return (
    <LangyCapabilityCard
      tone="read"
      surface="traces"
      overline="Traces"
      title={
        total != null
          ? `${total.toLocaleString()} ${total === 1 ? "trace" : "traces"}`
          : `${traces.length} traces`
      }
      projectSlug={projectSlug}
    >
      {queryHref ? (
        <OpenSearchButton
          query={search.query!}
          onOpen={() => void router.push(queryHref)}
        />
      ) : null}
      {shown.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {shown.map((trace) => (
            <CapabilityRow
              key={trace.id}
              href={buildSurfaceHref({
                surface: "traces",
                projectSlug,
                resourceId: trace.id,
              })}
              primary={trace.id}
              secondary={trace.snippet}
            />
          ))}
          {remaining > 0 ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
              +{remaining.toLocaleString()} more
            </Text>
          ) : null}
        </VStack>
      ) : (
        <Text textStyle="xs" color="fg.muted">
          No traces matched.
        </Text>
      )}
    </LangyCapabilityCard>
  );
}

/**
 * "Search this in Traces" — the query Langy wrote, handed to the Trace
 * Explorer's search bar.
 *
 * It shows the query itself rather than a bare verb, because the query IS the
 * claim: the user is about to hand a filter to a page they trust, and they
 * should be able to read it before they do. A truncated one still reads as a
 * query; a button labelled only "Open" asks them to take it on faith.
 */
function OpenSearchButton({
  query,
  onOpen,
}: {
  query: string;
  onOpen: () => void;
}) {
  return (
    <Button
      size="2xs"
      variant="outline"
      onClick={onOpen}
      marginBottom={2}
      maxWidth="100%"
      justifyContent="flex-start"
      title={`Search Traces for: ${query}`}
    >
      <Search size={11} />
      <Text truncate fontFamily="mono" textStyle="2xs">
        {query}
      </Text>
    </Button>
  );
}
