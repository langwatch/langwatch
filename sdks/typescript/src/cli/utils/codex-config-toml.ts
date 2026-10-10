/**
 * Idempotent merge of the LangWatch [otel] block into ~/.codex/config.toml.
 * Hand-written (not a TOML library) so existing ordering/comments survive
 * verbatim, touching only the region between the begin/end markers.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { normalizeEndpoint } from "../../internal/endpoint";

const BEGIN = "# >>> langwatch otel begin >>>";
const END = "# <<< langwatch otel end <<<";

export interface CodexOtelBlockInputs {
  /**
   * The bare ingestion base, e.g. https://app.langwatch.ai/api/otel. Codex's
   * OTLP config is signal-specific and appends no path of its own, so this
   * derives both endpoints: /v1/traces for traces, /v1/logs for events.
   */
  baseEndpoint: string;
  /** Plaintext personal ingest key (sk-lw-<...>). */
  ingestionToken: string;
  /** Logical environment label (e.g. user@org). Lands on resource.deployment.environment.name. */
  environment?: string;
}

/** Default config.toml path under the user's home directory. */
export function defaultCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) return path.join(codexHome, "config.toml");
  return path.join(os.homedir(), ".codex", "config.toml");
}

/** Path shown in the persist prompt (`~/.codex/config.toml`). */
export function displayCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) return path.join(codexHome, "config.toml");
  return "~/.codex/config.toml";
}

/**
 * The trace-signal endpoint codex's otlp-http exporter posts to. Unlike the
 * Node/Python/Go OTel SDKs, codex does NOT append `/v1/traces` itself, so
 * the suffix is spelled out here; callers pass the bare ingestion base.
 */
export function codexTraceEndpoint(baseEndpoint: string): string {
  return `${normalizeEndpoint(baseEndpoint)}/v1/traces`;
}

/**
 * The log-signal endpoint codex's EVENTS exporter (`[otel.exporter]`) posts
 * to — same reasoning as {@link codexTraceEndpoint}: codex appends nothing.
 */
export function codexLogsEndpoint(baseEndpoint: string): string {
  return `${normalizeEndpoint(baseEndpoint)}/v1/logs`;
}

/** Escape a value for a TOML basic (double-quoted) string. */
function tomlStr(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build the bracketed [otel] block with both signal exporters (metrics_exporter
 * is left alone). The trace exporter must stay FIRST: `codexOtelBlockEndpoint`
 * reads the block's first `endpoint =` line to detect login-time staleness.
 */
export function buildCodexOtelBlock(
  inputs: CodexOtelBlockInputs,
  options: { includeAuthHeader?: boolean } = {},
): string {
  const env = inputs.environment ?? "langwatch";
  const includeAuthHeader = options.includeAuthHeader ?? false;

  const authNote = includeAuthHeader
    ? [
        `# The Authorization header below carries a write-only ingest key so`,
        `# a plain 'codex' (without the langwatch wrapper) captures too. The`,
        `# file is written 0600; remove the marker pair to opt back out.`,
      ]
    : [
        `# Authorization header lives in OTEL_EXPORTER_OTLP_HEADERS;`,
        `# this file persists only the endpoint + environment label.`,
      ];

  const headerLine = `headers = { "Authorization" = "Bearer ${tomlStr(inputs.ingestionToken)}" }`;
  const traceExporter = [
    "[otel.trace_exporter.otlp-http]",
    `endpoint = "${tomlStr(codexTraceEndpoint(inputs.baseEndpoint))}"`,
    `protocol = "json"`,
  ];
  const eventsExporter = [
    "[otel.exporter.otlp-http]",
    `endpoint = "${tomlStr(codexLogsEndpoint(inputs.baseEndpoint))}"`,
    `protocol = "json"`,
  ];
  if (includeAuthHeader) {
    traceExporter.push(headerLine);
    eventsExporter.push(headerLine);
  }

  return [
    BEGIN,
    `# Managed by 'langwatch codex'. Re-running the command updates this`,
    `# block in place; remove the marker pair above and below to opt out.`,
    ...authNote,
    "[otel]",
    `environment = "${tomlStr(env)}"`,
    "",
    ...traceExporter,
    "",
    ...eventsExporter,
    END,
    "",
  ].join("\n");
}

/**
 * Whether the current langwatch [otel] block already carries a persisted
 * `headers` line (the inlined Authorization header) — used to stay quiet
 * in the persist offer once installed, and to let setup preserve it.
 */
export function codexOtelBlockHasAuthHeader(filePath: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return false;
  const block = content.slice(begin, end);
  return /^\s*headers\s*=/m.test(block);
}

/**
 * The trace-exporter endpoint currently written inside the langwatch [otel]
 * block, or null when absent. The login-time "latest login wins" refresh
 * compares this to the current login's endpoint to detect staleness.
 */
export function codexOtelBlockEndpoint(filePath: string = defaultCodexConfigPath()): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const block = content.slice(begin, end);
  const match = /^\s*endpoint\s*=\s*"([^"]*)"/m.exec(block);
  return match?.[1] ?? null;
}

/**
 * The log-signal endpoint from the langwatch `[otel]` block: the `endpoint`
 * line whose URL ends in `/v1/logs`. Null on a block written before the
 * events exporter existed — the caller's cue there is no endpoint to guess.
 */
export function codexOtelBlockLogsEndpoint(
  filePath: string = defaultCodexConfigPath(),
): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const block = content.slice(begin, end);
  for (const match of block.matchAll(/^\s*endpoint\s*=\s*"([^"]*)"/gm)) {
    const url = match[1];
    if (url?.endsWith("/v1/logs")) return url;
  }
  return null;
}

/**
 * The ingest token inlined on the langwatch `[otel]` block's `headers` entry,
 * or null when unset. The turn-completion harvest runs as a bare codex-spawned
 * process with no session/login, so this file is its only source of the key.
 */
export function codexOtelBlockAuthToken(
  filePath: string = defaultCodexConfigPath(),
): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const begin = content.indexOf(BEGIN);
  const end = content.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const block = content.slice(begin, end);
  const match = /"Authorization"\s*=\s*"Bearer\s+([^"]+)"/.exec(block);
  return match?.[1]?.trim() ?? null;
}

/**
 * Merge result returned by writeCodexOtelBlock so callers can
 * report which action was taken without re-reading the file.
 */
export type CodexOtelWriteAction = "created" | "updated" | "unchanged";

export interface CodexOtelWriteResult {
  action: CodexOtelWriteAction;
  path: string;
}

/**
 * Idempotent merge into codex config.toml: creates the file, appends the
 * block when no marker pair exists, or regex-replaces the bracketed region
 * in place — byte-for-byte unchanged inputs return 'unchanged'.
 */
export function writeCodexOtelBlock(
  inputs: CodexOtelBlockInputs,
  options: { filePath?: string; persistAuthHeader?: boolean } = {},
): CodexOtelWriteResult {
  const filePath = options.filePath ?? defaultCodexConfigPath();
  // Emit the Authorization header when explicitly asked (the persist
  // opt-in); otherwise preserve whatever the current block has, so the
  // unconditional setup write never strips a header a prior persist
  // installed.
  const includeAuthHeader = options.persistAuthHeader ?? codexOtelBlockHasAuthHeader(filePath);
  const block = buildCodexOtelBlock(inputs, { includeAuthHeader });

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFile0600(filePath, block);
    return { action: "created", path: filePath };
  }

  const prior = fs.readFileSync(filePath, "utf8");
  const re = new RegExp(`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`, "m");
  if (re.test(prior)) {
    const next = replaceVerbatim(prior, re, block);
    if (next === prior) return { action: "unchanged", path: filePath };
    writeFile0600(filePath, next);
    return { action: "updated", path: filePath };
  }

  const sep = prior.endsWith("\n") ? "\n" : "\n\n";
  writeFile0600(filePath, prior + sep + block);
  return { action: "updated", path: filePath };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Replace what `re` matches with `replacement`, verbatim. A *string*
 * replacement treats `$&`, `` $` ``, `$'`, `$n` as special, and TOML can
 * contain such sequences literally — a replacer function avoids that.
 */
function replaceVerbatim(content: string, re: RegExp, replacement: string): string {
  return content.replace(re, () => replacement);
}

/**
 * Write `content` and enforce `0600`. `writeFileSync`'s `mode` only applies
 * when creating a file, not an existing one — and these blocks can carry a
 * bearer token, so chmod BEFORE writing closes the world-readable window.
 */
function writeFile0600(filePath: string, content: string): void {
  if (fs.existsSync(filePath)) {
    fs.chmodSync(filePath, 0o600);
  }
  fs.writeFileSync(filePath, content, { mode: 0o600 });
  fs.chmodSync(filePath, 0o600);
}

const NOTIFY_BEGIN = "# >>> langwatch codex notify begin >>>";
const NOTIFY_END = "# <<< langwatch codex notify end <<<";

/**
 * Prefix stamped on a user-authored `notify` line moved aside because TOML
 * rejects a duplicate key outright; the original argv is preserved verbatim
 * in the comment and re-run via the chain arg in our own block.
 */
const DISPLACED_NOTE =
  "# langwatch moved this notify into the block at the top of the file, which still runs it:";

/**
 * Bracket the displaced assignment so removal restores exactly the lines it
 * commented out — without an explicit end, "comments after the note" would
 * silently annex whatever the user wrote below their own notify.
 */
const DISPLACED_BEGIN = "# >>> langwatch displaced notify begin >>>";
const DISPLACED_END = "# <<< langwatch displaced notify end <<<";

/** The whole displaced region, capturing the commented-out lines it stores. */
function displacedRegionRe(): RegExp {
  return new RegExp(
    `${escapeRe(DISPLACED_BEGIN)}\\n${escapeRe(DISPLACED_NOTE)}\\n([\\s\\S]*?)\\n${escapeRe(DISPLACED_END)}\\n?`,
    "m",
  );
}

/** Comment out the lines an assignment occupied, bracketed for exact recovery. */
function buildDisplacedRegion(raw: string): string {
  return [
    DISPLACED_BEGIN,
    DISPLACED_NOTE,
    ...raw.split("\n").map((line) => `# ${line}`),
    DISPLACED_END,
  ].join("\n");
}

/** Give the stored lines back exactly as the user wrote them. */
function uncommentDisplaced(commented: string): string {
  return commented
    .split("\n")
    .map((line) => line.replace(/^[ \t]*# ?/, ""))
    .join("\n");
}

/**
 * The user's own notify argv as a prior install stored it, or null when none
 * is displaced. Once written it is a comment, invisible to any scan for a
 * live `notify` — reading it back is what keeps a repeat install chaining it.
 */
function findDisplacedNotify(
  content: string,
): { start: number; end: number; argv: string[] } | null {
  const match = displacedRegionRe().exec(content);
  if (!match) return null;
  const argv = findNotifyAssignment(uncommentDisplaced(match[1] ?? ""))?.argv;
  if (!argv?.length) return null;
  return { start: match.index, end: match.index + match[0].length, argv };
}

export interface CodexNotifyBlockInputs {
  /**
   * The harvest argv up to but NOT including the trailing `--notify`: program
   * first, then args. The flag is appended here rather than by the caller
   * because it has to stay last, and that is easy to get wrong from outside.
   */
  command: string[];
  /** A user-authored notify argv to run after ours, when we displaced one. */
  chained?: readonly string[] | null;
}

/**
 * Flag carrying the turn payload. Codex appends its JSON as the final argv, so
 * this has to be the last thing we write or it captures one of our own args as
 * its value instead.
 */
const NOTIFY_PAYLOAD_FLAG = "--notify";

function tomlStringArray(values: readonly string[]): string {
  return `[${values.map((v) => `"${tomlStr(v)}"`).join(", ")}]`;
}

/**
 * The harvest argv to write into `notify`: absolute node binary + this CLI's
 * entry script, not the bare `langwatch` name — codex runs it in whatever
 * environment it started in, where a PATH-resolved name silently fails.
 */
export function defaultCodexNotifyCommand(): string[] | null {
  const entry = process.argv[1];
  if (!entry) return null;
  return [process.execPath, path.resolve(entry), "ingest", "codex"];
}

/**
 * Whether the harvest argv points into an ephemeral `npx` cache, which npm is
 * free to clean up. Capture would work now and silently stop later, so the
 * install path says so instead of pretending it is wired for good.
 */
export function codexNotifyCommandIsEphemeral(command: readonly string[]): boolean {
  return command.some((part) => part.includes("/_npx/") || part.includes("\\_npx\\"));
}

/**
 * Build the bracketed `notify` block. Codex's telemetry carries no conversation
 * content, so this points codex's post-turn hook at our harvest; a chained user
 * program runs first, then `--notify` LAST since codex appends the turn payload.
 */
export function buildCodexNotifyBlock(inputs: CodexNotifyBlockInputs): string {
  const chained = inputs.chained?.length ? ["--chain", JSON.stringify(inputs.chained)] : [];
  const argv = [...inputs.command, ...chained, NOTIFY_PAYLOAD_FLAG];
  return [
    NOTIFY_BEGIN,
    "# Managed by 'langwatch'. Codex runs this after every completed turn so",
    "# the conversation (prompt, tool calls, reply) lands on the same trace",
    "# codex already reports tokens on. Codex's own telemetry carries none of",
    "# that content. Remove the marker pair above and below to opt out.",
    `notify = ${tomlStringArray(argv)}`,
    NOTIFY_END,
    "",
  ].join("\n");
}

/** Where a line left the scanner: array nesting, and any open multi-line string. */
interface ScanState {
  depth: number;
  /** The delimiter of the multi-line string still open, null when none is. */
  openMultiline: '"""' | "'''" | null;
}

/**
 * Advance the scan across one line, ignoring brackets/`#` inside any of the
 * four TOML string forms — multi-line strings mean a line's meaning depends
 * on what an earlier line left open, and content inside a string is prose.
 */
interface StringScanState {
  quote: '"' | "'" | null;
  escaped: boolean;
}

interface LineScanState extends ScanState, StringScanState {
  index: number;
}

function scanQuotedCharacter(ch: string, state: StringScanState): void {
  if (state.escaped) {
    state.escaped = false;
  } else if (state.quote === '"' && ch === "\\") {
    state.escaped = true;
  } else if (ch === state.quote) {
    state.quote = null;
  }
}

function scanMultilineCharacter(line: string, state: LineScanState): void {
  if (state.escaped) {
    state.escaped = false;
    return;
  }
  // Literal multi-line strings do not honour backslash escapes.
  if (state.openMultiline === '"""' && line[state.index] === "\\") {
    state.escaped = true;
    return;
  }
  if (state.openMultiline !== null && line.startsWith(state.openMultiline, state.index)) {
    state.index += state.openMultiline.length - 1;
    state.openMultiline = null;
  }
}

function scanUnquotedCharacter(line: string, state: LineScanState): void {
  const ch = line[state.index];
  if (ch === '"' || ch === "'") {
    const triple = ch === '"' ? '"""' : "'''";
    if (line.startsWith(triple, state.index)) {
      state.openMultiline = triple;
      state.index += 2;
    } else {
      state.quote = ch;
    }
  } else if (ch === "#") {
    state.index = line.length;
  } else if (ch === "[") {
    state.depth++;
  } else if (ch === "]") {
    state.depth--;
  }
}

function scanLine(line: string, state: ScanState): ScanState {
  const cursor: LineScanState = { ...state, index: 0, quote: null, escaped: false };
  for (; cursor.index < line.length; cursor.index++) {
    if (cursor.openMultiline !== null) {
      scanMultilineCharacter(line, cursor);
    } else if (cursor.quote !== null) {
      scanQuotedCharacter(line[cursor.index]!, cursor);
    } else {
      scanUnquotedCharacter(line, cursor);
    }
  }

  // Only multi-line strings can continue onto the next line in TOML.
  return { depth: cursor.depth, openMultiline: cursor.openMultiline };
}

/**
 * Whether a line is a table header rather than a continuation of a multi-line
 * value. A header's brackets close on the same line; `[1, 2],` inside an array
 * does not, and only the former ends the top level.
 */
function isTableHeaderLine(line: string): boolean {
  if (!/^[ \t]*\[/.test(line)) return false;
  if (/^[ \t]*notify[ \t]*=/.test(line)) return false;
  return scanLine(line, { depth: 0, openMultiline: null }).depth === 0;
}

/**
 * Offsets of every live `notify = [` assignment above the file's first table
 * header — the ones TOML binds to no table, which is what codex reads.
 */
function topLevelNotifyOffsets(content: string): number[] {
  const found: number[] = [];
  let state: ScanState = { depth: 0, openMultiline: null };
  let offset = 0;
  for (const line of content.split("\n")) {
    // Inside a multi-line string every line is prose, including one that
    // happens to read like `[a.table]` or `notify = [...]`.
    if (state.depth === 0 && state.openMultiline === null) {
      // Everything past a table header belongs to that table.
      if (isTableHeaderLine(line)) return found;
      if (/^[ \t]*notify[ \t]*=[ \t]*\[/.test(line)) found.push(offset);
    }
    state = scanLine(line, state);
    offset += line.length + 1;
  }
  return found;
}

/**
 * The offset of codex's own top-level `notify = [`, or null. Depth is
 * tracked rather than cutting at the first `[`, since a multi-line array's
 * continuation can start with `[` too and risk a duplicate `notify` key.
 */
function topLevelNotifyMatch(content: string): { index: number } | null {
  const [first] = topLevelNotifyOffsets(content);
  return first === undefined ? null : { index: first };
}

/**
 * Codex's own top-level `notify` value, or null. "Top-level" is enforced,
 * not assumed — a bare key binds to the table above it, so `notify` nested
 * under an unrelated table is left alone rather than displaced and run.
 */
const TOML_ARRAY_ELEMENT = /"((?:[^"\\]|\\.)*)"|'([^']*)'/g;

interface NotifyAssignment {
  /** Offset of the assignment's first character. */
  start: number;
  /** Offset just past its closing `]`. */
  end: number;
  raw: string;
  argv: string[];
}

interface NotifyArrayScanState extends StringScanState {
  depth: number;
  elements: string;
}

function scanNotifyArrayCharacter(ch: string, state: NotifyArrayScanState): void {
  state.elements += ch;
  if (state.quote !== null) {
    scanQuotedCharacter(ch, state);
  } else if (ch === '"' || ch === "'") {
    state.quote = ch;
  } else if (ch === "[") {
    state.depth++;
  } else if (ch === "]") {
    state.depth--;
  }
}

function findNotifyArrayEnd(
  content: string,
  openIndex: number,
): {
  end: number;
  elements: string;
} | null {
  const state: NotifyArrayScanState = { depth: 0, quote: null, escaped: false, elements: "" };
  for (let i = openIndex; i < content.length; i++) {
    const ch = content[i]!;
    // Comments are prose: their quotes must never become chained programs.
    if (state.quote === null && ch === "#") {
      const lineEnd = content.indexOf("\n", i);
      if (lineEnd === -1) {
        return null;
      }
      state.elements += "\n";
      i = lineEnd;
      continue;
    }
    scanNotifyArrayCharacter(ch, state);
    if (state.depth === 0) {
      return { end: i + 1, elements: state.elements };
    }
  }
  return null;
}

function findNotifyAssignment(content: string): NotifyAssignment | null {
  const start = topLevelNotifyMatch(content);
  if (!start) {
    return null;
  }
  const array = findNotifyArrayEnd(content, content.indexOf("[", start.index));
  if (!array) {
    return null;
  }
  const { end, elements } = array;
  // Preserve the source span, including comments, when moving the assignment.
  const raw = content.slice(start.index, end);
  const argv = Array.from(elements.matchAll(TOML_ARRAY_ELEMENT)).map((m) =>
    m[1] !== undefined ? m[1].replace(/\\(.)/g, "$1") : (m[2] ?? ""),
  );
  return { start: start.index, end, raw, argv };
}

/** The argv codex currently runs on turn completion, or null when unset. */
export function codexNotifyCommand(filePath: string = defaultCodexConfigPath()): string[] | null {
  try {
    return findNotifyAssignment(fs.readFileSync(filePath, "utf8"))?.argv ?? null;
  } catch {
    return null;
  }
}

/** Whether config.toml currently carries the langwatch notify block. */
export function codexHasNotifyBlock(filePath: string = defaultCodexConfigPath()): boolean {
  return fileHasMarker(filePath, NOTIFY_BEGIN);
}

export interface CodexNotifyWriteResult {
  action: CodexOtelWriteAction;
  path: string;
  /** The user's own notify argv we displaced and now chain, when there was one. */
  chained: string[] | null;
}

/**
 * Idempotent merge of the notify block, written at the TOP of the file:
 * appended after `[otel]` like the other blocks, TOML would silently bind
 * it to that table as `otel.notify` instead of the top-level key codex reads.
 */
export function writeCodexNotifyBlock(
  inputs: CodexNotifyBlockInputs,
  options: { filePath?: string } = {},
): CodexNotifyWriteResult {
  const filePath = options.filePath ?? defaultCodexConfigPath();

  let prior = "";
  try {
    prior = fs.readFileSync(filePath, "utf8");
  } catch {
    /* absent — treated as empty below */
    void 0;
  }

  // Strip our own block first so the search for a foreign notify can't match
  // the one we wrote last time, and so a block left mid-file by an older
  // write is re-seated at the top.
  const withoutOurs = stripMarkerBlock(prior, NOTIFY_BEGIN, NOTIFY_END) ?? prior;

  const existing = findNotifyAssignment(withoutOurs);
  // With no live `notify` the user may still have one: an earlier install
  // already moved it into the displaced region, where it is a comment rather
  // than a key. That region is the only surviving record of it.
  const displaced = existing ? null : findDisplacedNotify(withoutOurs);
  const chained = existing?.argv.length ? existing.argv : (displaced?.argv ?? null);
  // Splice by the offsets the scanner resolved. Searching the file for the
  // assignment's text would land on the first copy of that spelling, and a
  // `notify` quoted in a comment or a `"""` block reads the same as the live
  // one, so the comment would be commented out and the real key left standing.
  const body = existing
    ? withoutOurs.slice(0, existing.start) +
      buildDisplacedRegion(existing.raw) +
      withoutOurs.slice(existing.end)
    : withoutOurs;

  const block = buildCodexNotifyBlock({ ...inputs, chained });
  const next = body.trim() ? `${block}\n${body.replace(/^\n+/, "")}` : block;

  // Last line of defence. Deciding which `notify` is codex's means reading
  // TOML with a line scanner, and a config shape it reads wrong would leave
  // two top-level `notify` keys — a duplicate key, which stops codex starting
  // at all. Refusing to write beats breaking the user's editor on a shape we
  // did not anticipate; capture stays off and says so.
  if (topLevelNotifyOffsets(next).length > 1) {
    throw new Error(
      `refusing to write ${filePath}: it already defines a top-level 'notify' this merge cannot safely move`,
    );
  }

  if (next === prior) return { action: "unchanged", path: filePath, chained };

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFile0600(filePath, next);
    return { action: "created", path: filePath, chained };
  }
  writeFile0600(filePath, next);
  return { action: "updated", path: filePath, chained };
}

/**
 * Remove the langwatch notify block, restoring a user-authored `notify` we had
 * commented out when we installed. Returns true when a block was removed.
 */
export function removeCodexNotifyBlock(filePath: string = defaultCodexConfigPath()): boolean {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false;
  }
  const stripped = stripMarkerBlock(content, NOTIFY_BEGIN, NOTIFY_END);
  if (stripped === null) return false;
  // Restore only what sits between the displaced markers. Matching "the run of
  // comment lines after the note" instead would swallow whatever the user had
  // written below their own notify and uncomment it, turning their prose into
  // bare TOML that codex then refuses to parse.
  const restored = stripped.replace(
    displacedRegionRe(),
    (_match, commented: string) => `${uncommentDisplaced(commented)}\n`,
  );
  fs.writeFileSync(filePath, restored);
  return true;
}

const GW_BEGIN = "# >>> langwatch gateway begin >>>";
const GW_END = "# <<< langwatch gateway end <<<";

export interface CodexGatewayBlockInputs {
  /** Gateway base URL, e.g. https://gateway.langwatch.ai */
  gatewayUrl: string;
  /**
   * Env var name codex should read the API key from. Defaults to
   * OPENAI_API_KEY, matching the wrapper's env injection: it sets
   * OPENAI_API_KEY to the user's VK before spawning codex.
   */
  envKey?: string;
}

export interface CodexGatewayWriteResult {
  action: CodexOtelWriteAction;
  /**
   * The ~/.codex/config.toml path that received the
   * [model_providers.langwatch] block.
   */
  path: string;
  /**
   * The separate ~/.codex/<profile>.config.toml path that received the
   * profile body — codex 0.134+ rejects inline [profiles.X] entries when
   * the user passes --profile X, requiring this sibling file.
   */
  profilePath: string;
  /**
   * Result of the profile-file write. Independent of `action` so
   * callers can report both writes accurately.
   */
  profileAction: CodexOtelWriteAction;
  /**
   * The profile name codex must be invoked with to route through the
   * langwatch provider (e.g. `codex --profile langwatch-gateway`) — returned
   * so the wrapper doesn't hardcode the name in two places.
   */
  profile: string;
}

const PROFILE_NAME = "langwatch-gateway";

/**
 * Build the additive [model_providers.langwatch] block. Codex 0.130+ ignores
 * OPENAI_API_KEY unless this provider is selected (`wire_api = "responses"`);
 * 0.134+ also rejects inline `[profiles.<name>]`, hence the sibling file.
 */
export function buildCodexGatewayBlock(inputs: CodexGatewayBlockInputs): string {
  const envKey = inputs.envKey ?? "OPENAI_API_KEY";
  const cleanedBase = normalizeEndpoint(inputs.gatewayUrl);
  const baseUrl = cleanedBase.endsWith("/v1") ? cleanedBase : `${cleanedBase}/v1`;
  return [
    GW_BEGIN,
    `# Managed by 'langwatch codex' (Path A wrapper). Re-running the`,
    `# wrapper updates this block in place; remove the marker pair`,
    `# above and below to opt back out.`,
    `# The wrapper spawns codex with --profile ${PROFILE_NAME} so this`,
    `# provider doesn't change codex's default model_provider.`,
    `# The matching profile body lives at ~/.codex/${PROFILE_NAME}.config.toml`,
    `# (codex 0.134+ requires the profile in a separate file).`,
    `[model_providers.langwatch]`,
    `name = "OpenAI"`,
    `base_url = "${baseUrl}"`,
    `env_key = "${envKey}"`,
    `wire_api = "responses"`,
    GW_END,
    "",
  ].join("\n");
}

/**
 * Contents of the sibling profile file; the filename IS the profile name.
 * Not bracketed with langwatch markers because the file is entirely
 * langwatch-owned, recreated fresh on every call — hand edits are lost.
 */
export function buildCodexGatewayProfileFile(): string {
  return [
    `# Managed by 'langwatch codex' (Path A wrapper).`,
    `# This file is the body of the '${PROFILE_NAME}' codex profile,`,
    `# selected at spawn time via 'codex --profile ${PROFILE_NAME}'.`,
    `# The matching [model_providers.langwatch] entry lives in`,
    `# ~/.codex/config.toml, bracketed by langwatch marker comments.`,
    `# Re-running 'langwatch codex' regenerates this file in place;`,
    `# remove it and the [model_providers.langwatch] block in`,
    `# config.toml to opt back out.`,
    `model_provider = "langwatch"`,
    "",
  ].join("\n");
}

/** Default path for the sibling profile file. */
export function defaultCodexProfilePath(profile: string = PROFILE_NAME): string {
  const codexHome = process.env.CODEX_HOME;
  const baseDir = codexHome ?? path.join(os.homedir(), ".codex");
  return path.join(baseDir, `${profile}.config.toml`);
}

/**
 * Merge the gateway provider block into config.toml and write the sibling
 * profile file in one call, so the wrapper can't end up half-installed —
 * the [otel] marker pair (Path B) coexists, but only one path fires per call.
 */
export function writeCodexGatewayBlock(
  inputs: CodexGatewayBlockInputs,
  options: { filePath?: string; profilePath?: string } = {},
): CodexGatewayWriteResult {
  const filePath = options.filePath ?? defaultCodexConfigPath();
  const profilePath = options.profilePath ?? defaultCodexProfilePath();
  const block = buildCodexGatewayBlock(inputs);
  const profileBody = buildCodexGatewayProfileFile();

  const action = writeGatewayConfigBlock(filePath, block);

  let profileAction: CodexOtelWriteAction;
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    writeFile0600(profilePath, profileBody);
    profileAction = "created";
  } else {
    const priorProfile = fs.readFileSync(profilePath, "utf8");
    if (priorProfile === profileBody) {
      profileAction = "unchanged";
    } else {
      writeFile0600(profilePath, profileBody);
      profileAction = "updated";
    }
  }

  return {
    action,
    path: filePath,
    profilePath,
    profileAction,
    profile: PROFILE_NAME,
  };
}

/** Exported so callers + tests can reference the profile name from one place. */
export const CODEX_GATEWAY_PROFILE_NAME = PROFILE_NAME;

/**
 * Cut a marker-bracketed langwatch block out of `content`, removing at most
 * one leading/trailing newline so the blank line the install path inserts
 * goes with it, without touching unrelated user whitespace. Null if absent.
 */
function stripMarkerBlock(content: string, begin: string, end: string): string | null {
  const re = new RegExp(`\\n?${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}\\n?`, "m");
  if (!re.test(content)) return null;
  return content.replace(re, "");
}

function removeMarkerBlockFromFile(filePath: string, begin: string, end: string): boolean {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return false; // ENOENT
  }
  const next = stripMarkerBlock(content, begin, end);
  if (next === null) return false;
  // Plain write preserves the file's existing mode (writeFileSync's `mode`
  // is ignored on an existing file) — removal strips our block, adding no
  // secret, so a pre-existing 0600 stays 0600.
  fs.writeFileSync(filePath, next);
  return true;
}

function fileHasMarker(filePath: string, begin: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf8").includes(begin);
  } catch {
    return false;
  }
}

/** Whether config.toml currently carries the langwatch `[otel]` block. */
export function codexHasOtelBlock(filePath: string = defaultCodexConfigPath()): boolean {
  return fileHasMarker(filePath, BEGIN);
}

/** Whether config.toml currently carries the langwatch gateway block. */
export function codexHasGatewayBlock(filePath: string = defaultCodexConfigPath()): boolean {
  return fileHasMarker(filePath, GW_BEGIN);
}

/**
 * The gateway URL written inside the langwatch gateway block, or null when
 * the file, the block or its `base_url` line is absent.
 */
export function codexGatewayBlockBaseUrl(
  filePath: string = defaultCodexConfigPath(),
): string | null {
  let content: string;
  try {
    content = fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
  const begin = content.indexOf(GW_BEGIN);
  const end = content.indexOf(GW_END);
  if (begin === -1 || end === -1 || end < begin) return null;
  const match = /^\s*base_url\s*=\s*"([^"]*)"/m.exec(content.slice(begin, end));
  return match?.[1] ?? null;
}

/**
 * Remove the langwatch `[otel]` (Path B) marker block from config.toml, if
 * present. User config outside the marker pair is preserved. Returns true
 * when a block was removed (idempotent — false when absent).
 */
export function removeCodexOtelBlock(filePath: string = defaultCodexConfigPath()): boolean {
  return removeMarkerBlockFromFile(filePath, BEGIN, END);
}

/**
 * Remove the langwatch gateway (Path A) provider marker block from
 * config.toml, if present. Returns true when a block was removed.
 */
export function removeCodexGatewayBlock(filePath: string = defaultCodexConfigPath()): boolean {
  return removeMarkerBlockFromFile(filePath, GW_BEGIN, GW_END);
}

/**
 * Delete the sibling `<profile>.config.toml` file, which is entirely
 * owned by langwatch. Returns true when a file was deleted (idempotent —
 * false when it was already absent).
 */
export function removeCodexGatewayProfileFile(
  profilePath: string = defaultCodexProfilePath(),
): boolean {
  if (!codexProfileFileIsLangwatchOwned(profilePath)) return false;
  fs.rmSync(profilePath, { force: true });
  return true;
}

/**
 * Whether `profilePath` looks like a profile body this CLI writes. The path
 * alone is a hint, not proof — this content check is what the logout scan
 * and remover gate on, so a non-owned file is never silently deleted.
 */
export function codexProfileFileIsLangwatchOwned(
  profilePath: string = defaultCodexProfilePath(),
): boolean {
  try {
    const content = fs.readFileSync(profilePath, "utf8");
    return /model_provider\s*=\s*"langwatch"/.test(content);
  } catch {
    return false;
  }
}

function writeGatewayConfigBlock(filePath: string, block: string): CodexOtelWriteAction {
  let action: CodexOtelWriteAction;
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    writeFile0600(filePath, block);
    action = "created";
  } else {
    const prior = fs.readFileSync(filePath, "utf8");
    const re = new RegExp(`${escapeRe(GW_BEGIN)}[\\s\\S]*?${escapeRe(GW_END)}\\n?`, "m");
    if (re.test(prior)) {
      const next = replaceVerbatim(prior, re, block);
      if (next === prior) {
        action = "unchanged";
      } else {
        writeFile0600(filePath, next);
        action = "updated";
      }
    } else {
      const sep = prior.endsWith("\n") ? "\n" : "\n\n";
      writeFile0600(filePath, prior + sep + block);
      action = "updated";
    }
  }

  return action;
}
