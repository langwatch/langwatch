/**
 * Carrying the agent's trace search into the Trace Explorer — and, for the
 * follow-up chips, into the automation drawer as an alert's subject
 * (`buildAutomationHref`). One reader, one quoting rule, every destination.
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
 *   dates  A window the agent NAMED is carried as ABSOLUTE `from`/`to` epoch-ms.
 *          A preset ("24h") re-computes against `now` on arrival, so a link
 *          opened ten minutes later would quietly query a different window than
 *          the agent pinned. Absolute is the only faithful option there.
 *          A window the agent did NOT name is a different case, and gets the
 *          opposite treatment for the same reason — see
 *          `CLI_DEFAULT_WINDOW_PRESET`. The CLI's own default is a ROLLING last
 *          day, so a rolling preset is what preserves it; emitting nothing at
 *          all drops the user into the Explorer's 30d default and turns a
 *          one-day question into a thirty-day one.
 *
 *   origin `--origin a,b` becomes `(origin:a OR origin:b)`, AND-ed onto the free
 *          text. It is a real Explorer field, so this one crosses intact. A
 *          filter that fails to cross does not make the link merely imprecise:
 *          it makes the Explorer answer a WIDER question than the card did, with
 *          bigger numbers that read as a correction rather than a discrepancy.
 *
 *   limit  CANNOT BE EXPRESSED. The fragment encodes `page`, never `pageSize`
 *          (`buildFragment` has no branch for it), so the CLI's `--limit 25` has
 *          nowhere to go. The Explorer therefore shows every trace in the
 *          window, of which the agent's result was the first N. That is a
 *          SUPERSET, never a different set — the traces on the card are all
 *          there, at the top. The card says "34 found — showing 3" so the user
 *          already knows the sample was a sample.
 */

// The Explorer's own value-quoting rule. Imported rather than reimplemented so
// a model id with a slash, or an origin with a space, is escaped here exactly
// as the filter sidebar would escape it.
import { escapeValue } from "~/server/app-layer/traces/query-language/mutations";

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
 *
 * This is carried as the Explorer's ROLLING preset, which is the one place this
 * module deliberately breaks its own absolute-times rule, because here the rule
 * would produce the less faithful link. The absolute rule exists for a search
 * whose window the agent PINNED: re-computing that against `now` on arrival
 * would silently move it. A default-window search pinned nothing — it asked for
 * "the last day", rolling, and the honest translation of a rolling window is a
 * rolling window.
 *
 * The alternative is worse in both directions: we do not know the wall-clock
 * time the search ran (the card's input carries flags, not a timestamp), so an
 * absolute window here would have to be anchored to the CLICK, quietly claiming
 * a precision we don't have. And emitting nothing at all — what this module did
 * before — drops the user into the Explorer's own 30d default, widening a
 * one-day question into a thirty-day one and changing every count on the page.
 */
const CLI_DEFAULT_WINDOW_PRESET = "24h";

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
    ...pick(readOrigins(record.origins ?? record.origin), (origins) => ({
      origins,
    })),
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
 * The whole search as ONE liqe expression — every narrowing the CLI applied,
 * in the grammar the Explorer reads.
 *
 * Both destinations go through here, which is the point: the Explorer link and
 * the automation's subject have to denote the same set of traces, and the only
 * way to guarantee that is for there to be one expression rather than two
 * built alike. It is also where a dropped filter shows up as a WIDER result
 * set, never a narrower one — `--origin` used to be parsed by nobody and the
 * link silently searched every origin in the project.
 *
 * Null when the search narrowed nothing, so callers can tell "no filter" from
 * "a filter that happens to be empty".
 */
export function buildExplorerQuery(search: TraceSearchQuery): string | null {
  const clauses: string[] = [];

  const query = search.query?.trim();
  if (query) clauses.push(asFreeTextTerm(query));

  // `--origin a,b` means "from a OR from b". Spelled the way the Explorer's own
  // filter sidebar spells a multi-value facet — `(origin:a OR origin:b)` — via
  // the same `escapeValue` it uses, so a value needing quotes gets them by the
  // Explorer's rule rather than by a second one invented here.
  const origins = search.origins?.filter((origin) => origin.trim() !== "");
  if (origins && origins.length > 0) {
    const group = origins
      .map((origin) => `origin:${escapeValue(origin)}`)
      .join(" OR ");
    clauses.push(origins.length > 1 ? `(${group})` : group);
  }

  if (clauses.length === 0) return null;
  // AND is explicit: liqe's implicit combinator is configurable, and a link is
  // read by a parser we don't control the settings of at the far end.
  return clauses.join(" AND ");
}

/**
 * The Explorer's fragment for this search: the default lens, plus whatever
 * survived of the query and the window. Shared by every link out of a trace
 * search, so the Explorer behind a drawer and the Explorer behind the card's
 * own button are always showing the same result set.
 */
function explorerFragment(search: TraceSearchQuery): string {
  const fragmentParams = new URLSearchParams();
  const query = buildExplorerQuery(search);
  if (query) fragmentParams.set("q", query);
  if (search.startDate !== undefined && search.endDate !== undefined) {
    fragmentParams.set("from", String(search.startDate));
    fragmentParams.set("to", String(search.endDate));
  } else {
    // The search still covered a window even though the agent named none — see
    // CLI_DEFAULT_WINDOW_PRESET. Saying nothing here is not neutral: it hands
    // the user to the Explorer's 30d default and changes the answer.
    fragmentParams.set("preset", CLI_DEFAULT_WINDOW_PRESET);
  }
  const fragmentQuery = fragmentParams.toString();
  return fragmentQuery
    ? `${TRACE_EXPLORER_LENS}?${fragmentQuery}`
    : TRACE_EXPLORER_LENS;
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

  const fragment = explorerFragment(search);

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
 *
 * `initialFilterQuery` is the drawer's existing ADR-043 seed — the exact prop
 * the Trace Explorer's own Automate button passes (`AutomateButton.tsx`,
 * `initialSource: "trace"` + the current filter text), riding the same
 * `drawer.*` URL params every drawer opens from (`CurrentDrawer` spreads them
 * as props). The free text goes in as a quoted liqe literal, so what was free
 * text to the CLI stays free text to the automation's matcher — the same
 * fidelity rule `q` obeys on the Explorer link.
 *
 * Null without any narrowing at all (no query, no origin filter): a bare
 * search has no subject to alert on, and the caller must offer plain
 * navigation instead of a carried label that lies.
 *
 * Lands on the Trace Explorer carrying the same fragment as every other link
 * out of the search, so behind the drawer — and after it closes — the user is
 * looking at the very traces the alert would match.
 */
export function buildAutomationHref({
  projectSlug,
  search,
}: {
  projectSlug?: string | null;
  search: TraceSearchQuery;
}): string | null {
  if (!projectSlug) return null;
  const query = buildExplorerQuery(search);
  if (!query) return null;

  const drawerParams = new URLSearchParams();
  drawerParams.set("drawer.open", "automation");
  drawerParams.set("drawer.initialSource", "trace");
  drawerParams.set("drawer.initialFilterQuery", query);

  return `/${projectSlug}/traces?${drawerParams.toString()}#${explorerFragment(search)}`;
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
 *
 * BACKSLASH ESCAPES ARE PART OF THAT, not a refinement of it. The agent composes
 * its command as a string and routinely nests one quoting level inside another —
 * `-q "\"override codes\""` is a shape observed live. Reading `\"` as a plain
 * closing quote ends the token early, so `-q "\"override codes\""` recovered as
 * `\override`: the phrase silently truncated at the space AND carrying a stray
 * backslash. That is the exact failure this module exists to prevent — a link
 * that quietly searches for something other than what the agent searched for —
 * so the escapes are honoured with the same rules a POSIX shell uses:
 *
 *   unquoted        `\X` is a literal X (the backslash is the escape, not data)
 *   double-quoted   only `\" \\ \$ \`` are escapes; any other backslash is
 *                   literal data, exactly as `sh` treats it
 *   single-quoted   nothing escapes, not even a backslash — the shell's own rule
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
 * structured transport. Undefined when nothing usable survived, so an empty or
 * whitespace-only flag reads as "no origin filter" rather than as a filter
 * matching nothing.
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
