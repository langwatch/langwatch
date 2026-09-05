/**
 * Preserve a Langy trace search when crossing from the CLI grammar into the Explorer's
 * liqe URL fragment. Free text is quoted so field-like text remains free text. Named
 * windows stay absolute; the unnamed CLI default stays a rolling day.
 */

// The Explorer's own value-quoting rule. Imported rather than reimplemented so
// a model id with a slash, or an origin with a space, is escaped here exactly
// as the filter sidebar would escape it.
import { escapeValue } from "@langwatch/trace-contract";

/** The CLI's `trace search` arguments, normalized. */
export interface TraceSearchQuery {
  /** Free-text query (`-q` / `--query`). */
  query?: string;
  /** `--origin`, split on commas. A trace matches if it came from ANY of them. */
  origins?: string[];
  /** Epoch ms. */
  startDate?: number;
  /** Epoch ms. */
  endDate?: number;
  /** `--limit`. Recorded for honesty; NOT expressible in the Explorer URL. */
  limit?: number;
}

/** The Explorer's default lens — the one an unfiltered explorer opens on. */
const TRACE_EXPLORER_LENS = "all-traces";

/**
 * The window `trace search` covers when the agent named none — the CLI's own
 * `oneDayAgo` default (`cli/commands/traces/search.ts`).
 */
const CLI_DEFAULT_WINDOW_PRESET = "24h";

/**
 * Recover the search the agent actually ran.
 */
export function readTraceSearchQuery(input: unknown): TraceSearchQuery {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;

  const command = record.command;
  if (typeof command === "string") return parseTraceSearchCommand(command);

  return {
    ...pick(readText(record.query ?? record.q), (query) => ({ query })),
    ...pick(readOrigins(record.origins ?? record.origin), (origins) => ({
      origins,
    })),
    ...pick(readEpochMs(record.startDate ?? record.start_date), (startDate) => ({
      startDate,
    })),
    ...pick(readEpochMs(record.endDate ?? record.end_date), (endDate) => ({
      endDate,
    })),
    ...pick(readInt(record.limit ?? record.pageSize), (limit) => ({ limit })),
  };
}

/** Pull `trace search`'s flags out of the shell command the agent ran. */
export function parseTraceSearchCommand(command: string): TraceSearchQuery {
  const tokens = tokenize(command);
  const search: TraceSearchQuery = {};

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i]!;
    const [flag, inlineValue] = splitFlag(token);
    // `--flag=value` carries its own value; `--flag value` takes the next token.
    const value = inlineValue ?? tokens[i + 1];
    if (value === undefined) continue;

    switch (flag) {
      case "-q":
      case "--query": {
        const text = readText(value);
        if (text !== undefined) search.query = text;
        break;
      }
      case "--origin": {
        const origins = readOrigins(value);
        if (origins !== undefined) search.origins = origins;
        break;
      }
      case "--start-date": {
        const at = readEpochMs(value);
        if (at !== undefined) search.startDate = at;
        break;
      }
      case "--end-date": {
        const at = readEpochMs(value);
        if (at !== undefined) search.endDate = at;
        break;
      }
      case "--limit": {
        const n = readInt(value);
        if (n !== undefined) search.limit = n;
        break;
      }
      default:
        break;
    }
  }

  return search;
}

/**
 * The whole search as ONE liqe expression — every narrowing the CLI applied, in the
 * grammar the Explorer reads.
 */
export function buildExplorerQuery(search: TraceSearchQuery): string | null {
  const clauses: string[] = [];

  const query = search.query?.trim();
  if (query) clauses.push(asFreeTextTerm(query));

  // `--origin a,b` means "from a OR from b".
  const origins = search.origins?.map((origin) => origin.trim()).filter((origin) => origin !== "");
  if (origins && origins.length > 0) {
    const group = origins.map((origin) => `origin:${escapeValue(origin)}`).join(" OR ");
    clauses.push(origins.length > 1 ? `(${group})` : group);
  }

  if (clauses.length === 0) return null;
  // AND is explicit: liqe's implicit combinator is configurable, and a link is
  // read by a parser we don't control the settings of at the far end.
  return clauses.join(" AND ");
}

/**
 * What an ABSENT window means for a given caller — which is not the same question for
 * every caller, and answering it wrong invents a filter.
 */
export type UnstatedWindow = "cli-last-24h" | "unknown";

/**
 * The Explorer's fragment for this search: the default lens, plus whatever survived of
 * the query and the window.
 */
function explorerFragment(search: TraceSearchQuery, unstatedWindow: UnstatedWindow): string {
  const fragmentParams = new URLSearchParams();
  const query = buildExplorerQuery(search);
  if (query) fragmentParams.set("q", query);
  if (search.startDate !== undefined && search.endDate !== undefined) {
    fragmentParams.set("from", String(search.startDate));
    fragmentParams.set("to", String(search.endDate));
  } else if (
    search.startDate === undefined &&
    search.endDate === undefined &&
    unstatedWindow === "cli-last-24h"
  ) {
    // NEITHER bound named AND the caller vouches for the CLI's own default: the
    // search covered the last day and we can say so exactly — see
    // CLI_DEFAULT_WINDOW_PRESET. Saying nothing here is not neutral; it hands
    // the user the Explorer's 30d default instead. Only the CLI's own search
    // carries that guarantee, which is why the caller has to state it.
    fragmentParams.set("preset", CLI_DEFAULT_WINDOW_PRESET);
  }
  // Exactly ONE bound named falls through deliberately, carrying no window at all.
  const fragmentQuery = fragmentParams.toString();
  return fragmentQuery ? `${TRACE_EXPLORER_LENS}?${fragmentQuery}` : TRACE_EXPLORER_LENS;
}

/**
 * The deep link into the Trace Explorer, carrying the agent's query.
 */
export function buildTraceExplorerHref({
  projectSlug,
  search,
  traceId,
  traceTimestamp,
  unstatedWindow = "unknown",
}: {
  projectSlug?: string | null;
  search: TraceSearchQuery;
  traceId?: string | null;
  traceTimestamp?: number | null;
  /** What an absent window means here — see {@link UnstatedWindow}. */
  unstatedWindow?: UnstatedWindow;
}): string | null {
  if (!projectSlug) return null;

  const fragment = explorerFragment(search, unstatedWindow);

  const drawerParams = new URLSearchParams();
  if (traceId) {
    drawerParams.set("drawer.open", "traceV2Details");
    drawerParams.set("drawer.traceId", traceId);
    // `t` is the partition-pruning hint `useTraceHeader` reads when it refetches
    // the heavy summary fields — the same one `useOpenTraceDrawer` passes.
    if (traceTimestamp != null && Number.isFinite(traceTimestamp)) {
      drawerParams.set("drawer.t", String(traceTimestamp));
    }
  }
  const drawerQuery = drawerParams.toString();

  return `/${projectSlug}/traces${drawerQuery ? `?${drawerQuery}` : ""}#${fragment}`;
}

/**
 * Open the automation drawer with the agent's search as the alert's SUBJECT.
 */
export function buildAutomationHref({
  projectSlug,
  search,
  unstatedWindow = "unknown",
}: {
  projectSlug?: string | null;
  search: TraceSearchQuery;
  /** What an absent window means here — see {@link UnstatedWindow}. */
  unstatedWindow?: UnstatedWindow;
}): string | null {
  if (!projectSlug) return null;
  const query = buildExplorerQuery(search);
  if (!query) return null;

  const drawerParams = new URLSearchParams();
  drawerParams.set("drawer.open", "automation");
  drawerParams.set("drawer.initialSource", "trace");
  drawerParams.set("drawer.initialFilterQuery", query);

  return `/${projectSlug}/traces?${drawerParams.toString()}#${explorerFragment(search, unstatedWindow)}`;
}

/**
 * Wrap text as a liqe QUOTED LITERAL, which parses as an `ImplicitField` tag and so
 * compiles to a free-text match — the same thing the CLI's `--query` does.
 */
export function asFreeTextTerm(text: string): string {
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Split `--flag=value` into its parts; a bare flag yields no inline value. */
function splitFlag(token: string): [string, string | undefined] {
  const equals = token.indexOf("=");
  if (!token.startsWith("-") || equals === -1) return [token, undefined];
  return [token.slice(0, equals), token.slice(equals + 1)];
}

/**
 * Split a shell command into tokens, honouring single and double quotes — the agent
 * writes `--query 'checkout failed'`, and splitting on whitespace would turn that into
 * two flags and a stray word.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i]!;

    if (quote === "'") {
      // Single quotes are literal through and through — a backslash inside them
      // is data, so this branch deliberately never looks at the next character.
      if (char === "'") quote = null;
      else current += char;
      continue;
    }

    if (char === "\\") {
      const next = command[i + 1];
      if (next === undefined) {
        current += char;
        continue;
      }
      // Inside double quotes a backslash only escapes the four characters the
      // shell lets it; before anything else it stands for itself.
      if (quote === '"' && !['"', "\\", "$", "`"].includes(next)) {
        current += char;
        continue;
      }
      current += next;
      hasContent = true;
      i++;
      continue;
    }

    if (quote === '"') {
      if (char === '"') quote = null;
      else current += char;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      hasContent = true;
      continue;
    }
    if (/\s/.test(char)) {
      if (current || hasContent) tokens.push(current);
      current = "";
      hasContent = false;
      continue;
    }
    current += char;
  }
  if (current || hasContent) tokens.push(current);

  return tokens;
}

/** Epoch ms from the CLI's "ISO string or epoch ms". */
function readEpochMs(value: unknown): number | undefined {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : undefined;
  }
  if (typeof value !== "string" || !value.trim()) return undefined;

  const asNumber = Number(value);
  if (Number.isFinite(asNumber)) return asNumber;

  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}

function readInt(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return undefined;
  return Math.trunc(n);
}

/**
 * The CLI's comma-separated `--origin`, split the way the CLI itself splits it
 * (`cli/commands/traces/origin-filter.ts`). An array is accepted too, for the
 * structured transport.
 */
function readOrigins(value: unknown): string[] | undefined {
  const raw = Array.isArray(value) ? value : [value];
  const origins = raw
    .flatMap((entry) => (typeof entry === "string" ? entry.split(",") : []))
    .map((origin) => origin.trim())
    .filter((origin) => origin !== "");
  return origins.length > 0 ? origins : undefined;
}

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Include a key only when its value survived parsing. */
function pick<T, R>(value: T | undefined, build: (value: T) => R): R | object {
  return value === undefined ? {} : build(value);
}
