/**
 * The lean half of `haven browser`: compact request and console lines, the
 * accessibility-tree diff an action prints, body redaction for `network show`
 * and the summary of a `profile stop` trace. Pure, so the tests reach it.
 */

/** One request a lane's page made; `status` and `ms` land as it answers. */
export type NetEntry = {
  id: number;
  method: string;
  url: string;
  type: string;
  start: number;
  status?: number;
  ms?: number;
  failed?: string;
};

/** One console message or uncaught page error. */
export type ConsoleEntry = { id: number; level: string; text: string; where?: string };

/** Resource types a network read leaves out unless asked for `--all`. */
const STATIC_TYPES = new Set([
  "image",
  "font",
  "stylesheet",
  "script",
  "media",
  "manifest",
  "texttrack",
]);

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Appends to a bounded list, dropping the oldest. */
export function pushRing<T>({ list, item, cap }: { list: T[]; item: T; cap: number }) {
  list.push(item);
  if (list.length > cap) list.splice(0, list.length - cap);
}

/** The app's own requests by path; anything else by host and path. */
export function shortUrl({ url, appHost }: { url: string; appHost: string }) {
  try {
    const parsed = new URL(url);
    const where = parsed.host === appHost ? "" : parsed.host;
    return clip(`${where}${parsed.pathname}${parsed.search}`, 140);
  } catch {
    return clip(url, 140);
  }
}

/** `#12 GET /api/trpc/x 200 34ms`, one line per request. */
export function netLine({ entry, appHost }: { entry: NetEntry; appHost: string }) {
  let outcome = entry.status === undefined ? "pending" : String(entry.status);
  if (entry.failed) outcome = `failed ${entry.failed}`;
  const ms = entry.ms === undefined ? "" : ` ${Math.round(entry.ms)}ms`;
  return `#${entry.id} ${entry.method} ${shortUrl({ url: entry.url, appHost })} ${outcome}${ms}`;
}

const isFailed = (entry: NetEntry) => Boolean(entry.failed) || (entry.status ?? 0) >= 400;

/** What a `network` read prints: after a cursor, matching grep, failed only, statics out. */
export function pickNet({
  entries,
  after = 0,
  grep,
  failed = false,
  all = false,
}: {
  entries: NetEntry[];
  after?: number;
  grep?: string;
  failed?: boolean;
  all?: boolean;
}) {
  const needle = grep?.toLowerCase();
  return entries.filter(
    (entry) =>
      entry.id > after &&
      (all || !STATIC_TYPES.has(entry.type) || isFailed(entry)) &&
      (!failed || isFailed(entry)) &&
      (!needle || `${entry.method} ${entry.url}`.toLowerCase().includes(needle)),
  );
}

/** `[error] message (where)`, one line, clipped. */
export function consoleLine({ entry }: { entry: ConsoleEntry }) {
  const text = clip(entry.text.replace(/\s+/g, " ").trim(), 300);
  return `[${entry.level}] ${text}${entry.where ? ` (${entry.where})` : ""}`;
}

const LEVEL_RANK: Record<string, number> = { debug: 0, log: 1, info: 1, warning: 2, error: 3 };

/** The messages a `console` read prints: after a cursor, at or above a level, matching grep. */
export function pickConsole({
  entries,
  after = 0,
  level,
  grep,
}: {
  entries: ConsoleEntry[];
  after?: number;
  level?: string;
  grep?: string;
}) {
  const floor = level ? (LEVEL_RANK[level === "warn" ? "warning" : level] ?? 0) : 0;
  const needle = grep?.toLowerCase();
  return entries.filter(
    (entry) =>
      entry.id > after &&
      (LEVEL_RANK[entry.level] ?? 1) >= floor &&
      (!needle || entry.text.toLowerCase().includes(needle)),
  );
}

const REF = / \[ref=[^\]]+\]/g;
const nodeOf = (line: string) => line.trim().replace(/^- /, "");
const keyOf = (line: string) =>
  nodeOf(line)
    .replace(REF, "")
    .replace(/ \[cursor=pointer\]/g, "");
const refOf = (line: string) => /\[ref=([^\]]+)\]/.exec(line)?.[1];

/** Lines of right with no equal (ref aside) in left, and lines of left with none in right. */
function unmatched({ left, right }: { left: string[]; right: string[] }) {
  const counts = new Map<string, number>();
  for (const line of left) counts.set(keyOf(line), (counts.get(keyOf(line)) ?? 0) + 1);
  const added = right.filter((line) => {
    const remaining = counts.get(keyOf(line)) ?? 0;
    if (remaining > 0) counts.set(keyOf(line), remaining - 1);
    return remaining === 0;
  });
  const removed = left.filter((line) => {
    const remaining = counts.get(keyOf(line)) ?? 0;
    if (remaining > 0) counts.set(keyOf(line), remaining - 1);
    return remaining > 0;
  });
  return { added, removed };
}

/**
 * What an action changed in an ai-mode snapshot: `~` a node whose ref kept but text
 * changed, `+` added, `-` removed, trimmed to maxLines with a footer.
 */
export function diffSnapshots({
  before,
  after,
  maxLines = 40,
}: {
  before: string;
  after: string;
  maxLines?: number;
}) {
  const left = before.split("\n").filter((line) => line.trim());
  const right = after.split("\n").filter((line) => line.trim());
  const { added, removed } = unmatched({ left, right });
  const changed: string[] = [];
  const addedByRef = new Map(added.flatMap((line) => (refOf(line) ? [[refOf(line), line]] : [])));
  const gone: string[] = [];
  for (const line of removed) {
    const ref = refOf(line);
    const now = ref ? addedByRef.get(ref) : undefined;
    if (!now) {
      gone.push(line);
      continue;
    }
    addedByRef.delete(ref);
    changed.push(`~ ${nodeOf(line).replace(REF, "")} -> ${nodeOf(now)}`);
  }
  const fresh = added.filter((line) => {
    const ref = refOf(line);
    return !ref || addedByRef.get(ref) === line;
  });
  const lines = [
    ...changed,
    ...fresh.map((line) => `+ ${nodeOf(line)}`),
    ...gone.map((line) => `- ${nodeOf(line)}`),
  ];
  if (lines.length <= maxLines) return lines;
  return [
    ...lines.slice(0, maxLines),
    `… ${lines.length - maxLines} more change(s); snapshot --grep for the rest`,
  ];
}

const SECRET_KEY =
  /pass(word)?|secret|token|api_?key|authorization|cookie|credential|private_?key|otp/i;
export const REDACTED_VALUE = "<redacted>";

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      SECRET_KEY.test(key) ? REDACTED_VALUE : redactValue(inner),
    ]),
  );
}

/** A request or response body for `network show`: secret-named fields hidden, clipped. */
export function redactBody({ text, max = 4000 }: { text: string; max?: number }) {
  if (!text) return "";
  let shown: string;
  try {
    shown = JSON.stringify(redactValue(JSON.parse(text)));
  } catch {
    shown = text.replace(
      /\b(pass(word)?|secret|token|api_?key|otp|csrfToken)=([^&\s]+)/gi,
      (_all, key: string) => `${key}=${REDACTED_VALUE}`,
    );
  }
  return clip(shown, max);
}

/** One Chrome trace event, the fields the summary reads. */
export type TraceEvent = {
  name: string;
  ph: string;
  ts: number;
  dur?: number;
  pid: number;
  tid: number;
  args?: { name?: string };
};

const SCRIPTING = new Set([
  "EvaluateScript",
  "FunctionCall",
  "v8.evaluateModule",
  "TimerFire",
  "EventDispatch",
  "FireAnimationFrame",
  "RunMicrotasks",
]);
const LAYOUT = new Set(["Layout", "UpdateLayoutTree"]);
const PAINT = new Set(["Paint", "PrePaint"]);

/** Total µs of the named events on main threads, a nested event counted once. */
function topLevelMicros({ events, names }: { events: TraceEvent[]; names: Set<string> }) {
  const ends = new Map<string, number>();
  let total = 0;
  for (const event of events) {
    if (!names.has(event.name)) continue;
    const thread = `${event.pid}:${event.tid}`;
    const end = event.ts + (event.dur ?? 0);
    if (event.ts < (ends.get(thread) ?? 0)) continue;
    ends.set(thread, end);
    total += event.dur ?? 0;
  }
  return total;
}

/** A `profile stop` trace in a few lines: long tasks, scripting/layout/paint, slowest requests. */
export function summariseTrace({
  events,
  requests,
  appHost,
}: {
  events: TraceEvent[];
  requests: NetEntry[];
  appHost: string;
}) {
  const mains = new Set(
    events
      .filter((e) => e.ph === "M" && e.name === "thread_name" && e.args?.name === "CrRendererMain")
      .map((e) => `${e.pid}:${e.tid}`),
  );
  const onMain = events
    .filter((e) => e.ph === "X" && mains.has(`${e.pid}:${e.tid}`))
    .toSorted((a, b) => a.ts - b.ts);
  const long = onMain.filter((e) => e.name === "RunTask" && (e.dur ?? 0) >= 50_000);
  const ms = (micros: number) => `${Math.round(micros / 1000)} ms`;
  // Loops, not Math.max(...): a real trace holds more events than the call stack.
  let first = Infinity;
  let last = 0;
  for (const e of events) {
    if (e.ts <= 0) continue;
    first = Math.min(first, e.ts);
    last = Math.max(last, e.ts + (e.dur ?? 0));
  }
  const span = last > 0 ? last - first : 0;
  const longest = long.reduce((top, e) => Math.max(top, e.dur ?? 0), 0);
  const slowest = requests
    .filter((entry) => entry.ms !== undefined)
    .toSorted((a, b) => (b.ms ?? 0) - (a.ms ?? 0))
    .slice(0, 5);
  return [
    `window: ${ms(span)} on ${mains.size} page thread(s)`,
    `long tasks (>=50 ms): ${long.length}, total ${ms(long.reduce((sum, e) => sum + (e.dur ?? 0), 0))}, longest ${ms(longest)}`,
    `scripting: ${ms(topLevelMicros({ events: onMain, names: SCRIPTING }))} · layout: ${ms(topLevelMicros({ events: onMain, names: LAYOUT }))} · paint: ${ms(topLevelMicros({ events: onMain, names: PAINT }))}`,
    ...(slowest.length
      ? ["slowest requests:", ...slowest.map((entry) => `  ${netLine({ entry, appHost })}`)]
      : []),
  ];
}
