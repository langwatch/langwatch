/**
 * Idempotent merge of the LangWatch [otel] activation block into
 * ~/.codex/config.toml.
 *
 * Codex 0.130+ links the opentelemetry-otlp Rust SDK but its
 * exporter is gated on a `[otel]` block in `~/.codex/config.toml` —
 * env vars alone are a silent no-op. The Path B install flow needs
 * to write this block for the user so the drawer / CLI surface
 * can collapse to a single command.
 *
 * Why a handwritten merger and not a TOML library: the file may
 * contain valid TOML the user authored by hand, and we want to
 * preserve ordering + comments verbatim. The merger only ever
 * appends a marker-bracketed block at the end of the file and
 * regex-replaces the same block on re-runs. No structural rewrite
 * of the existing TOML.
 *
 * Marker comments:
 *   # >>> langwatch otel begin >>>
 *   …
 *   # <<< langwatch otel end <<<
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BEGIN = "# >>> langwatch otel begin >>>";
const END = "# <<< langwatch otel end <<<";

export interface CodexOtelBlockInputs {
	/** Full OTLP endpoint, e.g. https://app.langwatch.ai/api/otel */
	endpoint: string;
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
 * The trace-signal endpoint codex's otlp-http exporter posts to. codex
 * (unlike the Node/Python/Go OTel SDKs) does NOT append `/v1/traces` to
 * the configured endpoint, so the suffix is spelled out here. Callers
 * pass the bare ingestion base (e.g. https://app.langwatch.ai/api/otel).
 */
export function codexTraceEndpoint(baseEndpoint: string): string {
	return `${baseEndpoint.replace(/\/+$/, "")}/v1/traces`;
}

/** Escape a value for a TOML basic (double-quoted) string. */
function tomlStr(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build the bracketed [otel] + [otel.trace_exporter.otlp-http] block.
 * Returned WITH leading + trailing markers and a trailing newline.
 *
 * codex 0.137+ separates `trace_exporter` (spans) from `exporter`
 * (logs) in its config schema. We emit the trace_exporter form so
 * Path B span ingestion fires; the older `[otel.exporter.otlp-http]`
 * form is silently ignored on traces in the current schema.
 *
 * `includeAuthHeader` controls whether the write-only ingest key is
 * inlined as a `headers` entry on the trace exporter. codex reads that
 * header on every run, so persisting it makes a plain `codex` (no
 * langwatch wrapper) capture without leaking OTEL vars into the shell
 * rc. When false, the header comes from OTEL_EXPORTER_OTLP_HEADERS at
 * runtime instead (the wrapper-only default that keeps the secret off
 * disk until the user opts in).
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

	const exporter = [
		"[otel.trace_exporter.otlp-http]",
		`endpoint = "${tomlStr(inputs.endpoint)}"`,
		`protocol = "json"`,
	];
	if (includeAuthHeader) {
		exporter.push(
			`headers = { "Authorization" = "Bearer ${tomlStr(inputs.ingestionToken)}" }`,
		);
	}

	return [
		BEGIN,
		`# Managed by 'langwatch codex'. Re-running the command updates this`,
		`# block in place; remove the marker pair above and below to opt out.`,
		...authNote,
		"[otel]",
		`environment = "${tomlStr(env)}"`,
		"",
		...exporter,
		END,
		"",
	].join("\n");
}

/**
 * Whether the current langwatch [otel] block in the file already
 * carries a persisted `headers` line (the inlined Authorization
 * header). Used to (a) stay quiet in the persist offer once the header
 * is installed and (b) let the unconditional setup write preserve it.
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
 * The trace-exporter endpoint currently written inside the langwatch
 * [otel] marker block, or null when the file / block / endpoint line is
 * absent. The login-time "latest login wins" refresh compares this to
 * the current login's endpoint to decide whether the block is stale.
 */
export function codexOtelBlockEndpoint(
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
	const match = /^\s*endpoint\s*=\s*"([^"]*)"/m.exec(block);
	return match?.[1] ?? null;
}

/**
 * The ingest token inlined on the langwatch `[otel]` block's `headers` entry,
 * or null when the block carries no persisted header.
 *
 * This is what lets the turn-completion harvest stand on its own: it runs as a
 * bare process codex spawned, with no session and no login to lean on, and the
 * one file that says "capture is on for plain codex" is the same file holding
 * the endpoint and key codex itself is posting with. Reading them back means
 * the harvest posts exactly where codex's own spans went.
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
 * Idempotent merge into the codex config.toml. Behaviour:
 *
 * - If the file does not exist: create the parent dir if needed,
 *   write the block as the entire file contents.
 * - If the file exists with NO marker pair: append the block + a
 *   leading blank line so it doesn't fuse with the prior section.
 * - If the file exists WITH a marker pair: regex-replace the
 *   bracketed region. The replacement is byte-for-byte the same
 *   when the inputs haven't changed → returns 'unchanged'.
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
	const includeAuthHeader =
		options.persistAuthHeader ?? codexOtelBlockHasAuthHeader(filePath);
	const block = buildCodexOtelBlock(inputs, { includeAuthHeader });

	if (!fs.existsSync(filePath)) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		writeFile0600(filePath, block);
		return { action: "created", path: filePath };
	}

	const prior = fs.readFileSync(filePath, "utf8");
	const re = new RegExp(
		`${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`,
		"m",
	);
	if (re.test(prior)) {
		const next = prior.replace(re, block);
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
 * Write `content` and enforce `0600`. `writeFileSync`'s `mode` option is
 * only honored when CREATING the file — on an existing file it is silently
 * ignored, leaving whatever permissions the file already had. Codex may
 * have created `config.toml` at `0644`, and these blocks can carry a bearer
 * token, so narrow the file to `0600` BEFORE writing when it already exists:
 * otherwise the token would land in a world-readable file for the window
 * between the write and a trailing chmod. On create, the `mode` option sets
 * `0600` up front. The final chmod is a belt-and-suspenders safety check.
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
 * Prefix stamped on a user-authored `notify` line we had to move aside. TOML
 * rejects a duplicate key outright, so leaving theirs in place next to ours
 * would stop codex from starting at all; the original argv is preserved
 * verbatim in the comment AND re-run via the chain arg in our own block.
 */
const DISPLACED_NOTE =
	"# langwatch moved this notify into the block at the top of the file, which still runs it:";

/**
 * Bracket the displaced assignment so removal restores exactly the lines it
 * commented out. Without an explicit end, "the comments after the note" is the
 * only available boundary, and that silently annexes whatever the user wrote
 * below their own notify.
 */
const DISPLACED_BEGIN = "# >>> langwatch displaced notify begin >>>";
const DISPLACED_END = "# <<< langwatch displaced notify end <<<";

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
 * The harvest argv to write into `notify`, as an absolute node binary plus this
 * CLI's own entry script.
 *
 * Spelled out rather than left as the bare `langwatch` name because codex runs
 * it as a plain process with whatever environment codex itself was started in:
 * a name resolved against PATH works from the shell the user installed from and
 * then quietly stops working from a launcher, a cron, or an editor terminal.
 *
 * Returns null when the entry script cannot be determined, which is the caller's
 * cue to skip the install rather than write an argv that will never run.
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
export function codexNotifyCommandIsEphemeral(
	command: readonly string[],
): boolean {
	return command.some(
		(part) => part.includes("/_npx/") || part.includes("\\_npx\\"),
	);
}

/**
 * Build the bracketed `notify` block, WITH markers and a trailing newline.
 *
 * Codex exports no conversation content on its telemetry signal — the reply is
 * parsed out of the streaming response and dropped before export, and no codex
 * setting turns it back on. What codex does offer is `notify`: a program it
 * runs after every completed turn, handed a JSON payload naming the session
 * that finished. Pointing that at our own harvest is what lets a plain `codex`
 * (no langwatch wrapper in front) record the conversation.
 *
 * The chained argv, when present, is the user's own notify program: we run it
 * after ours so installing capture never silently kills their notifications.
 * It is passed BEFORE `--notify` on purpose — codex appends the turn payload as
 * the final argv, so `--notify` has to be last to receive it as its value.
 */
export function buildCodexNotifyBlock(inputs: CodexNotifyBlockInputs): string {
	const chained = inputs.chained?.length
		? ["--chain", JSON.stringify(inputs.chained)]
		: [];
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

/**
 * Advance a bracket depth across one line, ignoring brackets inside strings and
 * after an unquoted `#`. Multi-line values are the reason this is needed: a
 * line's meaning depends on whether an earlier line left an array open.
 *
 * Both TOML string forms are tracked. Literal strings are single-quoted and
 * have no escape mechanism at all, so `path = 'C:\dir['` is an unbalanced
 * bracket that must not count — and single-quoted values are the form codex's
 * own documentation uses for commands.
 */
function bracketDepthAfterLine(line: string, depth: number): number {
	let next = depth;
	let quote: '"' | "'" | null = null;
	let escaped = false;
	for (const ch of line) {
		if (quote !== null) {
			// Only basic (double-quoted) strings honour backslash escapes.
			if (escaped) escaped = false;
			else if (quote === '"' && ch === "\\") escaped = true;
			else if (ch === quote) quote = null;
			continue;
		}
		if (ch === '"' || ch === "'") quote = ch;
		else if (ch === "#") break;
		else if (ch === "[") next++;
		else if (ch === "]") next--;
	}
	return next;
}

/**
 * Whether a line is a table header rather than a continuation of a multi-line
 * value. A header's brackets close on the same line; `[1, 2],` inside an array
 * does not, and only the former ends the top level.
 */
function isTableHeaderLine(line: string): boolean {
	if (!/^[ \t]*\[/.test(line)) return false;
	if (/^[ \t]*notify[ \t]*=/.test(line)) return false;
	return bracketDepthAfterLine(line, 0) === 0;
}

/**
 * Offsets of every live `notify = [` assignment above the file's first table
 * header — the ones TOML binds to no table, which is what codex reads.
 */
function topLevelNotifyOffsets(content: string): number[] {
	const found: number[] = [];
	let depth = 0;
	let offset = 0;
	for (const line of content.split("\n")) {
		if (depth === 0) {
			// Everything past a table header belongs to that table.
			if (isTableHeaderLine(line)) return found;
			if (/^[ \t]*notify[ \t]*=[ \t]*\[/.test(line)) found.push(offset);
		}
		depth = bracketDepthAfterLine(line, depth);
		offset += line.length + 1;
	}
	return found;
}

/**
 * The offset of codex's own top-level `notify = [` assignment, or null when the
 * file has none above its first table header.
 *
 * Depth is tracked rather than cutting at the first line that starts with `[`.
 * TOML lets an array span lines, so a nested one puts an element like `[1, 2],`
 * at the start of a continuation line. Reading that as a table header would
 * hide a genuinely top-level `notify` below it, and hiding it is not a benign
 * miss: the writer would then add a second `notify`, and a duplicate key stops
 * codex parsing its config at all.
 */
function topLevelNotifyMatch(content: string): { index: number } | null {
	const [first] = topLevelNotifyOffsets(content);
	return first === undefined ? null : { index: first };
}

/**
 * The value of codex's own top-level `notify` key in `content`, or null when
 * absent. Returns the raw matched text alongside the parsed argv so a caller
 * can move the exact lines it occupied.
 *
 * "Top-level" is enforced, not assumed. TOML binds a bare key to the table
 * above it, so `[integrations.slack]` followed by `notify = [...]` is
 * `integrations.slack.notify` and has nothing to do with codex — displacing it
 * would rewrite unrelated config and run someone else's program on every turn.
 *
 * Only single-line and simple multi-line array forms are recognised, which is
 * every form codex's own docs show. Anything else is left alone rather than
 * half-parsed — see `writeCodexNotifyBlock` for what that means for the user.
 */
function findNotifyAssignment(
	content: string,
): { raw: string; argv: string[] } | null {
	const start = topLevelNotifyMatch(content);
	if (!start) return null;
	const openIndex = content.indexOf("[", start.index);
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = openIndex; i < content.length; i++) {
		const ch = content[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "[") depth++;
		else if (ch === "]") {
			depth--;
			if (depth === 0) {
				const raw = content.slice(start.index, i + 1);
				const argv = Array.from(raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)).map((m) =>
					(m[1] ?? "").replace(/\\(.)/g, "$1"),
				);
				return { raw, argv };
			}
		}
	}
	return null;
}

/** The argv codex currently runs on turn completion, or null when unset. */
export function codexNotifyCommand(
	filePath: string = defaultCodexConfigPath(),
): string[] | null {
	try {
		return (
			findNotifyAssignment(fs.readFileSync(filePath, "utf8"))?.argv ?? null
		);
	} catch {
		return null;
	}
}

/** Whether config.toml currently carries the langwatch notify block. */
export function codexHasNotifyBlock(
	filePath: string = defaultCodexConfigPath(),
): boolean {
	return fileHasMarker(filePath, NOTIFY_BEGIN);
}

export interface CodexNotifyWriteResult {
	action: CodexOtelWriteAction;
	path: string;
	/** The user's own notify argv we displaced and now chain, when there was one. */
	chained: string[] | null;
}

/**
 * Idempotent merge of the notify block into config.toml.
 *
 * The block is always written at the TOP of the file. `notify` is a top-level
 * key, and TOML binds a bare key to whatever table precedes it — appended after
 * the `[otel]` block the way the other blocks are, it would silently become
 * `otel.notify`, which codex ignores without complaint. Writing it first is the
 * one placement that cannot be wrong regardless of what the user's file holds.
 *
 * A user-authored `notify` is moved aside rather than left in place: TOML
 * forbids a duplicate key, so keeping both would stop codex from starting. The
 * displaced argv is commented out where it stood and re-run from our block.
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
	}

	// Strip our own block first so the search for a foreign notify can't match
	// the one we wrote last time, and so a block left mid-file by an older
	// write is re-seated at the top.
	const withoutOurs =
		stripMarkerBlock(prior, NOTIFY_BEGIN, NOTIFY_END) ?? prior;

	const existing = findNotifyAssignment(withoutOurs);
	const chained = existing?.argv.length ? existing.argv : null;
	const body = existing
		? withoutOurs.replace(
				existing.raw,
				[
					DISPLACED_BEGIN,
					DISPLACED_NOTE,
					...existing.raw.split("\n").map((line) => `# ${line}`),
					DISPLACED_END,
				].join("\n"),
			)
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
export function removeCodexNotifyBlock(
	filePath: string = defaultCodexConfigPath(),
): boolean {
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
		new RegExp(
			`${escapeRe(DISPLACED_BEGIN)}\\n${escapeRe(DISPLACED_NOTE)}\\n([\\s\\S]*?)\\n${escapeRe(DISPLACED_END)}\\n?`,
			"m",
		),
		(_match, commented: string) =>
			`${commented
				.split("\n")
				.map((line) => line.replace(/^[ \t]*# ?/, ""))
				.join("\n")}\n`,
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
	 * OPENAI_API_KEY because that's the standard codex env. The
	 * wrapper still sets OPENAI_API_KEY to the user's VK before
	 * spawning codex, so this matches the wrapper's env injection
	 * out of the box.
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
	 * The separate ~/.codex/<profile>.config.toml path that received
	 * the profile body. codex 0.134+ rejects [profiles.X] entries
	 * inside config.toml when the user passes --profile X, requiring
	 * a sibling file named <profile>.config.toml.
	 */
	profilePath: string;
	/**
	 * Result of the profile-file write. Independent of `action` so
	 * callers can report both writes accurately.
	 */
	profileAction: CodexOtelWriteAction;
	/**
	 * The profile name codex must be invoked with to actually route
	 * through the langwatch provider — e.g. `codex --profile
	 * langwatch-gateway`. Returned so the wrapper doesn't have to
	 * hardcode the name in two places.
	 */
	profile: string;
}

const PROFILE_NAME = "langwatch-gateway";

/**
 * Build the additive [model_providers.langwatch] block that lives
 * in ~/.codex/config.toml. Codex 0.130+ defaults to ChatGPT OAuth
 * and ignores OPENAI_API_KEY unless an explicit model_provider
 * config is selected with `name = "OpenAI"`, `env_key`, and
 * `wire_api = "responses"` (the "chat" wire_api is no longer
 * supported per the codex binary strings dump).
 *
 * Codex 0.134+ rejects a [profiles.<name>] entry inside
 * config.toml when the user passes --profile <name>; the profile
 * body is now written to a sibling file (see buildCodexGatewayProfileFile).
 */
export function buildCodexGatewayBlock(
	inputs: CodexGatewayBlockInputs,
): string {
	const envKey = inputs.envKey ?? "OPENAI_API_KEY";
	const cleanedBase = inputs.gatewayUrl.replace(/\/+$/, "");
	const baseUrl = cleanedBase.endsWith("/v1")
		? cleanedBase
		: `${cleanedBase}/v1`;
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
 * Build the contents of the sibling profile file
 * (~/.codex/langwatch-gateway.config.toml). The filename IS the
 * profile name; the body holds the settings that previously went
 * under [profiles.langwatch-gateway] inside config.toml.
 *
 * We DO NOT bracket this file with langwatch markers because the
 * file is entirely owned by langwatch — the wrapper creates it
 * fresh on every invocation. Hand-edits to it will be overwritten
 * (a header comment explains this to anyone reading the file).
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
export function defaultCodexProfilePath(
	profile: string = PROFILE_NAME,
): string {
	const codexHome = process.env.CODEX_HOME;
	const baseDir = codexHome ?? path.join(os.homedir(), ".codex");
	return path.join(baseDir, `${profile}.config.toml`);
}

/**
 * Idempotent merge of the gateway provider block into config.toml
 * + write of the sibling profile file. Both writes happen in one
 * call so the wrapper can't end up with a half-installed state.
 *
 * config.toml: regex-replace inside the marker pair or append. The
 * [otel] marker pair (Path B) coexists independently — a user who
 * runs both Path A and Path B keeps both blocks; only one fires per
 * invocation per the no-double-trace rule.
 *
 * <profile>.config.toml: full-file replace. The file is entirely
 * owned by langwatch.
 */
export function writeCodexGatewayBlock(
	inputs: CodexGatewayBlockInputs,
	options: { filePath?: string; profilePath?: string } = {},
): CodexGatewayWriteResult {
	const filePath = options.filePath ?? defaultCodexConfigPath();
	const profilePath = options.profilePath ?? defaultCodexProfilePath();
	const block = buildCodexGatewayBlock(inputs);
	const profileBody = buildCodexGatewayProfileFile();

	let action: CodexOtelWriteAction;
	if (!fs.existsSync(filePath)) {
		fs.mkdirSync(path.dirname(filePath), { recursive: true });
		writeFile0600(filePath, block);
		action = "created";
	} else {
		const prior = fs.readFileSync(filePath, "utf8");
		const re = new RegExp(
			`${escapeRe(GW_BEGIN)}[\\s\\S]*?${escapeRe(GW_END)}\\n?`,
			"m",
		);
		if (re.test(prior)) {
			const next = prior.replace(re, block);
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
 * Cut a marker-bracketed langwatch block out of `content`. Removes at most
 * one leading newline and one trailing newline around the block so the
 * blank line the install path inserts before the block goes with it, but
 * unrelated user whitespace is left alone. Returns the stripped content, or
 * null when no such block is present.
 */
function stripMarkerBlock(
	content: string,
	begin: string,
	end: string,
): string | null {
	const re = new RegExp(
		`\\n?${escapeRe(begin)}[\\s\\S]*?${escapeRe(end)}\\n?`,
		"m",
	);
	if (!re.test(content)) return null;
	return content.replace(re, "");
}

function removeMarkerBlockFromFile(
	filePath: string,
	begin: string,
	end: string,
): boolean {
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
export function codexHasOtelBlock(
	filePath: string = defaultCodexConfigPath(),
): boolean {
	return fileHasMarker(filePath, BEGIN);
}

/** Whether config.toml currently carries the langwatch gateway block. */
export function codexHasGatewayBlock(
	filePath: string = defaultCodexConfigPath(),
): boolean {
	return fileHasMarker(filePath, GW_BEGIN);
}

/**
 * Remove the langwatch `[otel]` (Path B) marker block from config.toml, if
 * present. User config outside the marker pair is preserved. Returns true
 * when a block was removed (idempotent — false when absent).
 */
export function removeCodexOtelBlock(
	filePath: string = defaultCodexConfigPath(),
): boolean {
	return removeMarkerBlockFromFile(filePath, BEGIN, END);
}

/**
 * Remove the langwatch gateway (Path A) provider marker block from
 * config.toml, if present. Returns true when a block was removed.
 */
export function removeCodexGatewayBlock(
	filePath: string = defaultCodexConfigPath(),
): boolean {
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
 * Whether the file at `profilePath` looks like the profile body this CLI
 * writes (`model_provider = "langwatch"`, the entire content of
 * buildCodexGatewayProfileFile()) rather than some unrelated file a user
 * happened to place at this distinctively-named path. The path name alone
 * is a strong hint but not proof of ownership - this content check is what
 * the logout scan and the remover itself gate listing/deletion on, so a
 * non-owned file at the same path is never presented as removable or
 * silently deleted.
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
