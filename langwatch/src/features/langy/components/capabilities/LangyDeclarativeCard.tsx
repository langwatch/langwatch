/**
 * The declarative capability card — one component that draws every result the
 * catalog describes, from the body widget its descriptor names.
 *
 * The bespoke cards (traces, metrics, eval runs, datasets, scenarios) stay
 * hand-built; everything else lands here: the write fall-throughs (created /
 * updated / removed), the generic reads, the prompt diff, and the version-skew
 * fallback for a command this UI has never heard of. The widget vocabulary is
 * the catalog's (`stats` / `rows` / `facts` / `diff` / `text` / `chart`), and
 * each widget reads the already-parsed card payload from the shared
 * `@langwatch/langy` contract — parsed against the card the result was
 * DECIDED to be, not one re-derived from the command's name here.
 *
 * Honesty rule (same as the trace cards): output that cannot be read renders
 * as "couldn't read this result" with the deep link kept — never as a
 * confident empty state manufactured out of garbage. An EMPTY parsed result is
 * a real answer and says so in real words.
 */
import { Box, Grid, Text, VStack } from "@chakra-ui/react";
import { parseCardResult, type CliResultDigest } from "@langwatch/langy";
import type { LangyTurnMetric } from "../../hooks/useLangyTurnSignals";
import {
  useCapabilityData,
  type CapabilityData,
} from "../../hooks/useCapabilityData";
import { StreamingStatCard } from "../StreamingStatCard";
import {
  buildResourceHref,
  buildSurfaceHref,
  extractPrimaryId,
  extractResourceName,
  extractToolText,
  SURFACE_LABEL,
  summaryLines,
  type CapabilityCardInput,
  type CapabilityDescriptor,
} from "./capabilityRegistry";
import { collectionOf, totalOf } from "./cliResultDocument";
import {
  CapabilityRow,
  CapabilityRowSkeletons,
  LangyCapabilityCard,
} from "./LangyCapabilityCard";
import { isPlottable, TimeseriesPlot } from "./LangyTimeseriesCard";

const MAX_ROWS = 5;
const MAX_FACTS = 6;
const MAX_STATS = 4;
const SNIPPET_MAX = 100;

function truncate(text: string, max: number): string {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** `updatedAt` / `record_count` → "updated at" / "record count". */
function labelize(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
}

/** A row/document's human name, checked in the order a reader would want. */
const NAME_KEYS = ["name", "title", "displayName", "label", "handle", "slug"];
/** A row/document's id, however this endpoint spelled it. */
const ROW_ID_KEYS = ["id", "trace_id", "traceId", "runId", "slug", "key"];

function firstString(value: unknown, keys: string[]): string | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const v = record[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return null;
}

/** Renderable primitive → display text; null for anything structural. */
function displayValue(value: unknown): string | null {
  if (typeof value === "string") return value.trim() ? truncate(value, SNIPPET_MAX) : null;
  if (typeof value === "number") return value.toLocaleString();
  if (typeof value === "boolean") return value ? "yes" : "no";
  return null;
}

// Fields worth reading first in a facts grid, in the order a reader would
// scan a resource: what it is, what state it's in, when it changed.
const FACT_PRIORITY = [
  "id",
  "name",
  "title",
  "slug",
  "handle",
  "status",
  "state",
  "provider",
  "model",
  "version",
  "scope",
  "enabled",
  "recordCount",
  "createdAt",
  "updatedAt",
];

/**
 * The label→value pairs a single resource is worth summarising with. A fact
 * whose value the card already shows as its title is skipped — "Faithfulness"
 * twice in one card says nothing new.
 */
function factsOf(
  document: unknown,
  { omitValue }: { omitValue?: string | null } = {},
): { label: string; value: string }[] {
  if (!document || typeof document !== "object" || Array.isArray(document)) {
    return [];
  }
  const record = document as Record<string, unknown>;
  const facts: { label: string; value: string }[] = [];
  const seen = new Set<string>();

  const push = (key: string) => {
    if (seen.has(key) || facts.length >= MAX_FACTS) return;
    const value = displayValue(record[key]);
    if (value === null || value === omitValue) return;
    seen.add(key);
    facts.push({ label: labelize(key), value });
  };

  for (const key of FACT_PRIORITY) push(key);
  for (const key of Object.keys(record)) push(key);
  return facts;
}

/** The labelled figures a document reports: its own numbers, or its row count. */
function statsOf(document: unknown): LangyTurnMetric[] {
  const rows = collectionOf(document);
  if (rows) {
    const total = totalOf(document) ?? rows.length;
    // Just the count. Summing a "cost" stat here would mean guessing which key
    // holds the money (`cost`? `totalCost`? `costUsd`?) across every collection
    // the CLI can return — the payload-sniffing this renderer exists to avoid.
    // When money is the answer, the agent says so by emitting a card that names
    // it; the generic renderer does not infer it.
    return [{ value: total, label: total === 1 ? "result" : "results" }];
  }
  if (!document || typeof document !== "object") return [];

  const stats: LangyTurnMetric[] = [];
  // Run-shaped results first (passed/failed/total), then whatever other
  // numbers the document reports, capped so the row stays a row.
  const record = document as Record<string, unknown>;
  const keys = [
    ...["passed", "failed", "total"].filter((k) => k in record),
    ...Object.keys(record).filter(
      (k) => !["passed", "failed", "total"].includes(k),
    ),
  ];
  for (const key of keys) {
    if (stats.length >= MAX_STATS) break;
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) continue;
    stats.push({ value, label: labelize(key) });
  }
  return stats;
}

/** The fields a diff result says changed, from whatever shape it chose. */
function changedFields(changes: unknown): string[] {
  if (Array.isArray(changes)) {
    return changes
      .map((c) =>
        typeof c === "string" ? c : firstString(c, ["field", "name", "key"]),
      )
      .filter((c): c is string => !!c);
  }
  if (changes && typeof changes === "object") {
    return Object.keys(changes as Record<string, unknown>);
  }
  return [];
}

/** The prompt text a diff carries, for the mono preview block. */
function promptContent(input: unknown, output: unknown): string | null {
  for (const source of [input, output]) {
    if (!source || typeof source !== "object") continue;
    const obj = source as Record<string, unknown>;
    if (typeof obj.prompt === "string" && obj.prompt.trim()) return obj.prompt;
    if (typeof obj.content === "string" && obj.content.trim())
      return obj.content;
  }
  return null;
}

/** Quiet single-line body used by sentences and honest failure states. */
function BodyLine({ children }: { children: string }) {
  return (
    <Text textStyle="xs" color="fg.muted">
      {children}
    </Text>
  );
}

function SummaryLinesBody({ lines }: { lines: string[] }) {
  return (
    <VStack align="stretch" gap={0.5}>
      {lines.map((line, i) => (
        <Text key={i} textStyle="xs" color="fg.muted" lineHeight="1.45">
          {line}
        </Text>
      ))}
    </VStack>
  );
}

/**
 * The honest failure body: the result could not be read as anything. Points
 * at the surface only when the card actually links there.
 */
function UnreadableBody({
  descriptor,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  projectSlug: string | null;
}) {
  const linked = buildSurfaceHref({ surface: descriptor.surface, projectSlug });
  return (
    <BodyLine>
      {linked
        ? `Couldn't read this result. Open ${SURFACE_LABEL[descriptor.surface]} to see it.`
        : "Couldn't read this result."}
    </BodyLine>
  );
}

function RowsBody({
  descriptor,
  document,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  document: unknown;
  projectSlug: string | null;
}) {
  const rows = collectionOf(document);
  if (!rows) {
    // The document is a single resource after all — read it as one.
    return <FactsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
  }

  if (rows.length === 0) {
    const searched = ["search", "query"].includes(descriptor.command.verb);
    return (
      <BodyLine>
        {searched
          ? `No ${descriptor.noun.plural} matched.`
          : `No ${descriptor.noun.plural} yet.`}
      </BodyLine>
    );
  }

  const shown = rows.slice(0, MAX_ROWS);
  const total = totalOf(document) ?? rows.length;
  const remaining = total - shown.length;

  return (
    <VStack align="stretch" gap={0}>
      {shown.map((row, index) => {
        const name = firstString(row, NAME_KEYS);
        const id = firstString(row, ROW_ID_KEYS);
        const primary = name ?? id ?? `${capitalize(descriptor.noun.singular)} ${index + 1}`;
        const secondary =
          firstString(row, ["status", "state", "description"]) ??
          (name && id && id !== name ? id : null);
        return (
          <CapabilityRow
            key={id ?? index}
            href={buildResourceHref({
              surface: descriptor.surface,
              projectSlug,
              resourceId: id,
            })}
            primary={primary}
            secondary={secondary ? truncate(secondary, SNIPPET_MAX) : undefined}
          />
        );
      })}
      {remaining > 0 ? (
        <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
          +{remaining.toLocaleString()} more
        </Text>
      ) : null}
    </VStack>
  );
}

function FactsBody({
  descriptor,
  document,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  document: unknown;
  projectSlug: string | null;
}) {
  if (Array.isArray(document) || collectionOf(document)) {
    // The document is a collection after all — read it as one.
    return <RowsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
  }

  // The card's title already shows the resource's name — don't repeat it.
  const facts = factsOf(document, {
    omitValue: firstString(document, NAME_KEYS),
  });
  if (facts.length === 0) {
    return <UnreadableBody descriptor={descriptor} projectSlug={projectSlug} />;
  }

  return (
    <Grid templateColumns="max-content 1fr" columnGap={3} rowGap={0.5}>
      {facts.map((fact) => (
        <Box key={fact.label} display="contents">
          <Text textStyle="2xs" color="fg.subtle">
            {fact.label}
          </Text>
          <Text textStyle="xs" color="fg" wordBreak="break-word">
            {fact.value}
          </Text>
        </Box>
      ))}
    </Grid>
  );
}

function StatsBody({
  descriptor,
  document,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  document: unknown;
  projectSlug: string | null;
}) {
  const stats = statsOf(document);
  if (stats.length === 0) {
    // Nothing counts as a figure — the resource's fields still tell the story.
    return <FactsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
  }
  return <StreamingStatCard metrics={stats} />;
}

function DiffBody({
  descriptor,
  document,
  input,
  output,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  document: unknown;
  input: unknown;
  output: unknown;
  projectSlug: string | null;
}) {
  const record =
    document && typeof document === "object" && !Array.isArray(document)
      ? (document as { version?: unknown; changes?: unknown })
      : null;
  const version = record?.version;
  const fields = changedFields(record?.changes);
  const content = promptContent(input, output);

  if (!record && !content) {
    return <UnreadableBody descriptor={descriptor} projectSlug={projectSlug} />;
  }

  return (
    <VStack align="stretch" gap={1.5}>
      {version != null && (typeof version === "string" || typeof version === "number") ? (
        <Text textStyle="2xs" color="fg.muted">
          Version {version}
        </Text>
      ) : null}
      {fields.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {fields.map((field) => (
            <CapabilityRow key={field} primary={labelize(field)} secondary="changed" />
          ))}
        </VStack>
      ) : content ? (
        <Box
          as="pre"
          textStyle="2xs"
          fontFamily="mono"
          color="fg"
          background="bg.muted"
          borderWidth="1px"
          borderStyle="solid"
          borderColor="border.muted"
          borderRadius="sm"
          padding={2}
          margin={0}
          maxHeight="160px"
          overflowY="auto"
          whiteSpace="pre-wrap"
          wordBreak="break-word"
        >
          {content}
        </Box>
      ) : (
        <BodyLine>Saved as a new version.</BodyLine>
      )}
    </VStack>
  );
}

/** The settled-write sentence, by tone. */
function writeSentence(tone: CapabilityDescriptor["tone"]): string {
  switch (tone) {
    case "created":
      return "Created and ready to use.";
    case "removed":
      return "Removed.";
    default:
      return "Saved.";
  }
}

/**
 * (`isUnconfirmedCreate` lived here. It is gone, and so is the "Couldn't
 * confirm the resource was created" card it drew: a create whose result names
 * nothing now renders no card at all, decided once at the selection boundary in
 * `hasCapabilityCard`. Owning the doubt in a card was still a card about
 * nothing, and it appeared beside the error card for the same operation.)
 */

export function LangyDeclarativeCard({
  descriptor,
  input,
  output,
  digest,
  projectSlug: rawProjectSlug,
}: CapabilityCardInput) {
  const projectSlug = rawProjectSlug ?? null;
  const { tone, body, noun } = descriptor;

  // Hydration is for COLLECTION reads: fresh names and links for the entities
  // the result referenced. Facts/stats/diff keep the stored structure (the
  // richer view for one resource), and writes are a sentence, not a fetch.
  const hydration = useCapabilityData({
    digest: tone === "read" && body === "rows" ? (digest ?? null) : null,
  });

  // Read against the card that was DECIDED, never a kind re-derived from the
  // command's name here — that is a second decision point, and a promoted
  // result would be read by the schema of the card it did not get. See
  // ADR-059 §1.
  const parsed = parseCardResult({ kind: descriptor.render, output });
  const document = parsed.ok ? parsed.card : null;

  if (hydration.status !== "idle") {
    return (
      <HydratedRowsCard
        descriptor={descriptor}
        hydration={hydration}
        digest={digest ?? null}
        projectSlug={projectSlug}
      />
    );
  }

  // The output often arrives as a JSON string; the parsed document is the
  // readable form of it, so names and ids come from there when it exists.
  const name = extractResourceName(input, document ?? output);
  const id = extractPrimaryId(input, document ?? output);

  // A settled write is a sentence, not a document — unless the catalog asked
  // for a richer widget (a prompt push renders its diff).
  if (tone !== "read" && (body === "text" || !parsed.ok)) {
    const removed = tone === "removed";
    return (
      <LangyCapabilityCard
        tone={tone}
        surface={descriptor.surface}
        overline={descriptor.overline}
        title={name ?? capitalize(noun.singular)}
        projectSlug={projectSlug}
        // A removed resource has no page left — link to the surface index.
        resourceId={removed ? null : id}
        icon={descriptor.icon}
      >
        <BodyLine>{writeSentence(tone)}</BodyLine>
      </LangyCapabilityCard>
    );
  }

  const title = readTitle({ descriptor, document, name, id });

  return (
    <LangyCapabilityCard
      tone={tone}
      surface={descriptor.surface}
      overline={descriptor.overline}
      title={title}
      projectSlug={projectSlug}
      resourceId={tone === "removed" ? null : id}
      icon={descriptor.icon}
    >
      {parsed.ok ? (
        <WidgetBody
          descriptor={descriptor}
          document={document}
          input={input}
          output={output}
          projectSlug={projectSlug}
        />
      ) : (
        <TextFallbackBody
          descriptor={descriptor}
          output={output}
          projectSlug={projectSlug}
        />
      )}
    </LangyCapabilityCard>
  );
}

/**
 * A collection read rendered from its REFERENCES: rows hydrated fresh through
 * the product's own API, titled by the digest's honest counts. Skeleton rows
 * hold the known count while the fetch is in flight; entities the API no
 * longer returns render as an honest sentence with the counts and the way
 * into the surface preserved — never as a fabricated empty result.
 */
function HydratedRowsCard({
  descriptor,
  hydration,
  digest,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  hydration: CapabilityData;
  digest: CliResultDigest | null;
  projectSlug: string | null;
}) {
  const { noun } = descriptor;
  const returned = digest?.counts?.returned ?? null;
  const total = hydration.totalCount ?? returned;
  const title =
    total !== null
      ? `${total.toLocaleString()} ${total === 1 ? noun.singular : noun.plural}`
      : capitalize(noun.plural);

  return (
    <LangyCapabilityCard
      tone="read"
      surface={descriptor.surface}
      overline={descriptor.overline}
      title={title}
      projectSlug={projectSlug}
      icon={descriptor.icon}
    >
      {hydration.isHydrating && hydration.rows.length === 0 ? (
        <CapabilityRowSkeletons
          count={Math.min(returned ?? 3, MAX_ROWS)}
        />
      ) : hydration.rows.length > 0 ? (
        <VStack align="stretch" gap={0}>
          {hydration.rows.map((row) => (
            <CapabilityRow
              key={row.id}
              href={buildResourceHref({
                surface: descriptor.surface,
                projectSlug,
                resourceId: row.id,
              })}
              primary={row.primary ?? row.id}
              secondary={row.secondary}
            />
          ))}
          {total !== null && total > hydration.rows.length ? (
            <Text textStyle="2xs" color="fg.subtle" paddingX={2} paddingTop={1}>
              +{(total - hydration.rows.length).toLocaleString()} more
            </Text>
          ) : null}
        </VStack>
      ) : (
        <BodyLine>
          {hydration.status === "unavailable"
            ? `Couldn't load these ${noun.plural} right now.`
            : returned === 1
              ? `This ${noun.singular} is no longer available.`
              : `These ${noun.plural} are no longer available.`}
        </BodyLine>
      )}
    </LangyCapabilityCard>
  );
}

function WidgetBody({
  descriptor,
  document,
  input,
  output,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  document: unknown;
  input: unknown;
  output: unknown;
  projectSlug: string | null;
}) {
  switch (descriptor.body) {
    case "rows":
      return <RowsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
    case "facts":
      return <FactsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
    case "stats":
      return <StatsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
    case "diff":
      return (
        <DiffBody
          descriptor={descriptor}
          document={document}
          input={input}
          output={output}
          projectSlug={projectSlug}
        />
      );
    case "text": {
      const lines = summaryLines(output, 3);
      if (lines.length === 0) {
        return <UnreadableBody descriptor={descriptor} projectSlug={projectSlug} />;
      }
      return <SummaryLinesBody lines={lines} />;
    }
    // The same plot the timeseries card draws, not a second one. A document
    // with nothing plottable in it is not a chart, whatever the catalog asked
    // for, and its figures are the next most honest reading of it.
    case "chart":
      return isPlottable(document) ? (
        <TimeseriesPlot payload={document} />
      ) : (
        <StatsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />
      );
    // A widget the catalog grows before this switch does. Falling off the end
    // of the switch returned `undefined` — a card with no body at all, which
    // is how a registered `chart` widget rendered nothing for as long as it
    // existed. Facts read every document, so they are the safe floor.
    default:
      return <FactsBody descriptor={descriptor} document={document} projectSlug={projectSlug} />;
  }
}

/**
 * The result was not a JSON document. Plain console lines still read honestly
 * as text; something that LOOKS like a document but would not parse (truncated
 * upstream) must own the failure instead.
 */
function TextFallbackBody({
  descriptor,
  output,
  projectSlug,
}: {
  descriptor: CapabilityDescriptor;
  output: unknown;
  projectSlug: string | null;
}) {
  const text = extractToolText(output).trim();
  const looksLikeBrokenDocument =
    text.startsWith("{") || text.startsWith("[");
  if (!text || looksLikeBrokenDocument) {
    return <UnreadableBody descriptor={descriptor} projectSlug={projectSlug} />;
  }
  return <SummaryLinesBody lines={summaryLines(output, 3)} />;
}

/** Title for a read card: an honest count for a list, the thing's name otherwise. */
function readTitle({
  descriptor,
  document,
  name,
  id,
}: {
  descriptor: CapabilityDescriptor;
  document: unknown;
  name: string | null;
  id: string | null;
}): string {
  const { body, noun } = descriptor;
  if (body === "rows") {
    const rows = collectionOf(document);
    if (rows) {
      const total = totalOf(document) ?? rows.length;
      return `${total.toLocaleString()} ${total === 1 ? noun.singular : noun.plural}`;
    }
    return capitalize(noun.plural);
  }
  return name ?? id ?? capitalize(noun.singular);
}
