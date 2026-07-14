/**
 * Carrying the agent's trace search into the Trace Explorer.
 *
 * When Langy answers "34 traces errored overnight", the user's next move is to
 * go look at them. That link has exactly one job and it is easy to get subtly
 * wrong: it must land them on THE SAME RESULT SET the card just showed them, not
 * on a naked, unfiltered explorer that happens to be full of traces. A link that
 * silently changes the question is worse than no link.
 *
 * Two grammars have to be bridged, and they are not the same grammar:
 *
 *   THE CLI ran `langwatch trace search -q <text> --start-date <d> --end-date <d>
 *   --limit <n>`. Its `--query` is the legacy free-text search field
 *   (`sharedFiltersInputSchema.query`) — plain text, matched against trace
 *   content. Its dates are epoch-ms or ISO.
 *
 *   THE EXPLORER keeps its state in the URL FRAGMENT, not the query string:
 *   `/<project>/traces#<lensId>?q=&from=&to=&page=` (see
 *   `traces-v2/utils/urlState.ts`). Its `q` is not free text — it is a liqe
 *   expression, compiled to ClickHouse by `filter-to-clickhouse/ast.ts`.
 *
 * The bridge is the one place those two meet, so it is worth being precise:
 *
 *   query  A bare/quoted term in liqe parses as an `ImplicitField`, and
 *          `translateTag` sends exactly that to `translateFreeText`. So free
 *          text in, free text out: the CLI's `--query` becomes a QUOTED literal
 *          in `q`. Quoting is not incidental — it is what guarantees fidelity.
 *          `--query 'status:error'` was free text to the CLI, and quoting keeps
 *          it free text in the Explorer instead of silently promoting it to a
 *          field filter that means something else entirely.
 *          `traceExplorerLink.unit.test.ts` runs the built `q` through the
 *          Explorer's REAL parser and asserts it comes back as an implicit
 *          free-text term, so this claim is checked rather than asserted.
 *
 *   dates  Carried as ABSOLUTE `from`/`to` epoch-ms, never as a rolling preset.
 *          A preset ("24h") re-computes against `now` on arrival, so a link
 *          opened ten minutes later would quietly query a different window than
 *          the agent did. Absolute is the only faithful option here.
 *
 *   limit  CANNOT BE EXPRESSED. The fragment encodes `page`, never `pageSize`
 *          (`buildFragment` has no branch for it), so the CLI's `--limit 25` has
 *          nowhere to go. The Explorer therefore shows every trace in the
 *          window, of which the agent's result was the first N. That is a
 *          SUPERSET, never a different set — the traces on the card are all
 *          there, at the top. The card says "34 found — showing 3" so the user
 *          already knows the sample was a sample.
 */

/** The CLI's `trace search` arguments, normalized. */
export interface TraceSearchQuery {
  /** Free-text query (`-q` / `--query`). */
  query?: string;
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
 * Recover the search the agent actually ran.
 *
 * The CLI envelope records the tool call under `langwatch.trace.search` but
 * leaves the tool INPUT as opencode's original shell payload — `{ command:
 * "langwatch trace search …" }` — because it only ever needed the resource and
 * the verb. So the flags have to come back out of the command string. A
 * structured input (the older MCP transport, and the gallery's fixtures) is
 * accepted too.
 */
export function readTraceSearchQuery(input: unknown): TraceSearchQuery {
  if (!input || typeof input !== "object") return {};
  const record = input as Record<string, unknown>;

  const command = record.command;
  if (typeof command === "string") return parseTraceSearchCommand(command);

  return {
    ...pick(readText(record.query ?? record.q), (query) => ({ query })),
    ...pick(
      readEpochMs(record.startDate ?? record.start_date),
      (startDate) => ({
        startDate,
      }),
    ),
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
 * The deep link into the Trace Explorer, carrying the agent's query.
 *
 * With a `traceId`, the link ALSO opens that trace's drawer on arrival — the
 * same URL-routed drawer the trace table opens (`drawer.open=traceV2Details`),
 * so a row on the card and a row in the table lead to exactly the same place.
 * The drawer params ride in the query string; the Explorer's own state rides in
 * the fragment. They don't collide.
 *
 * Null without a project slug, so callers hide the control rather than link
 * somewhere broken.
 */
export function buildTraceExplorerHref({
  projectSlug,
  search,
  traceId,
  traceTimestamp,
}: {
  projectSlug?: string | null;
  search: TraceSearchQuery;
  traceId?: string | null;
  traceTimestamp?: number | null;
}): string | null {
  if (!projectSlug) return null;

  const fragmentParams = new URLSearchParams();
  const query = search.query?.trim();
  if (query) fragmentParams.set("q", asFreeTextTerm(query));
  if (search.startDate !== undefined && search.endDate !== undefined) {
    fragmentParams.set("from", String(search.startDate));
    fragmentParams.set("to", String(search.endDate));
  }
  const fragmentQuery = fragmentParams.toString();
  const fragment = fragmentQuery
    ? `${TRACE_EXPLORER_LENS}?${fragmentQuery}`
    : TRACE_EXPLORER_LENS;

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
 * Wrap text as a liqe QUOTED LITERAL, which parses as an `ImplicitField` tag and
 * so compiles to a free-text match — the same thing the CLI's `--query` does.
 * Without the quotes, `status:error` would parse as a field filter and the user
 * would land on a different result set than the card showed them.
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
 * Split a shell command into tokens, honouring single and double quotes — the
 * agent writes `--query 'checkout failed'`, and splitting on whitespace would
 * turn that into two flags and a stray word.
 */
function tokenize(command: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | null = null;
  let hasContent = false;

  for (const char of command) {
    if (quote) {
      if (char === quote) quote = null;
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

function readText(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

/** Include a key only when its value survived parsing. */
function pick<T, R>(value: T | undefined, build: (value: T) => R): R | object {
  return value === undefined ? {} : build(value);
}
