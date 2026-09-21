/**
 * The pure session-context vocabulary: everything needed to turn a git
 * identity plus a session id into one OTLP log record, with no process,
 * filesystem or network access of its own. Two seams build the same record
 * from it: `langwatch ingest hook <tool>` (a hook payload plus a live `git`
 * run) and the codex rollout harvest (the identity codex wrote into its own
 * transcript).
 *
 * Kept separate from those seams so each piece is directly testable, the
 * remote-URL grammar in particular, which has to cope with every shape a
 * user's `origin` can take (scp-like ssh, ssh:// with a port, https with
 * credentials, nested GitLab groups, a `.git` suffix or none).
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

/** The event every session-context record carries, on the record and as an attribute. */
export const SESSION_CONTEXT_EVENT_NAME = "langwatch.session_context";

/**
 * The instrumentation scope the record is emitted under. Deliberately a
 * langwatch name: the pipeline admits this event by its own name and scope,
 * never by imitating a vendor's instrumentation scope.
 */
export const SESSION_CONTEXT_SCOPE_NAME = "langwatch.coding_agent.hook";

/** Matches the service.name the CLI's other OTLP emitter reports. */
const SERVICE_NAME = "langwatch-cli";

/**
 * The attribute a derived title rides on. Codex generates no title of its
 * own, so the harvest names the session from the transcript's first typed
 * prompt; the platform fills an empty title from it and lets an
 * agent-generated title outrank it.
 */
const SESSION_TITLE_ATTR = "langwatch.session.title";

/**
 * The attribute the session's OWN name rides on: the name the harness itself
 * holds (claude's `--name` flag and `/rename` command, codex's thread name),
 * mirrored by the capture seams rather than invented by them. The platform
 * folds the newest name onto the session's title in place, above both
 * derived titles.
 */
const SESSION_NAME_ATTR = "langwatch.session.name";

/** The most of a prompt or a name that becomes a session's title. */
const MAX_PROMPT_TITLE_CHARS = 120;

/**
 * A session name as the harness reported it, trimmed and capped like the
 * derived titles. Whitespace is no name.
 */
export function normalizeSessionName(
	raw: string | null | undefined,
): string | null {
	const trimmed = raw?.trim();
	if (!trimmed) return null;
	return trimmed.slice(0, MAX_PROMPT_TITLE_CHARS);
}

/**
 * A session name out of a prompt's text: the first line, whitespace
 * collapsed, capped. Null when the text is empty or opens with a tag —
 * agents inject notifications and context as user turns wrapped in tags,
 * and a session named `<environment_context>` names nothing.
 */
export function sessionTitleFromPrompt(text: string): string | null {
	const trimmed = text.trim();
	if (trimmed === "" || trimmed.startsWith("<")) return null;
	const firstLine = trimmed.split(/\r?\n/, 1)[0] ?? "";
	const collapsed = firstLine.replace(/\s+/g, " ").trim();
	if (collapsed === "") return null;
	return collapsed.slice(0, MAX_PROMPT_TITLE_CHARS);
}

/** INFO, from the OTel log data model severity numbers. */
const SEVERITY_INFO = 9;

/** The repository a session is working in, as its origin remote names it. */
export interface RepositoryIdentity {
	host: string;
	owner: string;
	name: string;
}

/** The git identity of one session at one moment. */
export interface SessionContext {
	/**
	 * Absent when the session ran outside any git repository. The record is
	 * still worth posting then: it is what creates the session row for agents
	 * whose own telemetry cannot (codex), and what carries the titles.
	 */
	repository?: RepositoryIdentity;
	/** Absent on a detached HEAD. */
	branch?: string;
	/** Absent unless the checkout is a linked worktree. */
	worktree?: string;
}

/** The W3C trace context a Stop hook inherits from the live session. */
export interface TraceContext {
	traceId: string;
	spanId: string;
}

interface OtlpAnyValue {
	stringValue: string;
}

interface OtlpKeyValue {
	key: string;
	value: OtlpAnyValue;
}

interface OtlpLogRecord {
	timeUnixNano: string;
	severityNumber: number;
	severityText: string;
	eventName: string;
	attributes: OtlpKeyValue[];
	traceId?: string;
	spanId?: string;
}

/** One OTLP/HTTP JSON logs request, carrying exactly one record. */
export interface OtlpLogsPayload {
	resourceLogs: Array<{
		resource: { attributes: OtlpKeyValue[] };
		scopeLogs: Array<{
			scope: { name: string; version: string };
			logRecords: OtlpLogRecord[];
		}>;
	}>;
}

/** A URL with an explicit scheme, as opposed to the scp-like ssh shorthand. */
const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;

/** `[user@]host:path`, git's scp-like shorthand and the default for ssh remotes. */
const SCP_LIKE = /^(?:[^@/]+@)?([^:/]+):(.+)$/;

const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-/;

/** An id made entirely of zeroes, which W3C defines as invalid. */
const ALL_ZERO = /^0+$/;

/**
 * Read `{host, owner, name}` out of an origin remote URL. Null when the URL
 * is empty, unparseable, or carries no owner/name pair, which the caller
 * treats the same way it treats a directory with no remote at all.
 *
 * Nested paths keep every segment but the last as the owner, so a GitLab
 * subgroup remote reports `group/subgroup` rather than losing the group it
 * lives under.
 */
export function parseGitRemoteUrl(url: string): RepositoryIdentity | null {
	const trimmed = url.trim();
	if (trimmed === "") return null;

	if (SCHEME.test(trimmed)) {
		try {
			const parsed = new URL(trimmed);
			return identityFrom(parsed.hostname, parsed.pathname);
		} catch {
			return null;
		}
	}

	const scp = SCP_LIKE.exec(trimmed);
	if (!scp) return null;
	return identityFrom(scp[1]!, scp[2]!);
}

function identityFrom(
	host: string,
	rawPath: string,
): RepositoryIdentity | null {
	const segments = rawPath.split("/").filter((segment) => segment !== "");
	if (host === "" || segments.length < 2) return null;

	const name = segments[segments.length - 1]!.replace(/\.git$/i, "");
	const owner = segments.slice(0, -1).join("/");
	if (name === "" || owner === "") return null;

	return { host: host.toLowerCase(), owner, name };
}

/**
 * The string the hook compares against what it last sent for this session.
 * Every field that can change mid-session is in it, so a branch switch or a
 * move to another worktree re-posts while a quiet session stays quiet.
 */
export function sessionContextFingerprint(
	{ repository, branch, worktree }: SessionContext,
	titles?: { title?: string | null; name?: string | null },
): string {
	const repo = repository
		? `${repository.host}/${repository.owner}/${repository.name}`
		: "";
	// The titles are part of the identity on purpose: a renamed session must
	// re-post, or the rename never reaches the platform.
	return `${repo}@${branch ?? ""}#${worktree ?? ""}!${titles?.title ?? ""}~${titles?.name ?? ""}`;
}

/**
 * Parse `OTEL_EXPORTER_OTLP_HEADERS` (comma-separated `key=value` pairs, the
 * first `=` splitting the two) into a header map. A pair with no `=`, or an
 * empty key, is dropped rather than guessed at.
 */
export function parseOtlpHeaders(
	raw: string | undefined,
): Record<string, string> {
	const headers: Record<string, string> = {};
	for (const pair of (raw ?? "").split(",")) {
		const trimmed = pair.trim();
		const separator = trimmed.indexOf("=");
		if (separator <= 0) continue;
		const key = trimmed.slice(0, separator).trim();
		if (key === "") continue;
		headers[key] = trimmed.slice(separator + 1).trim();
	}
	return headers;
}

/**
 * The trace and span ids out of a W3C `traceparent`. Only version `00` is
 * accepted: a future version may lay its fields out differently, and a
 * misread id would attach the record to a trace that does not exist.
 *
 * All-zero ids are rejected for the same reason. They are the W3C spelling of
 * "there is no valid context here", and OTel SDKs emit that string verbatim
 * when asked to inject one, so honouring it would point the record at a trace
 * that was never created.
 */
export function parseTraceparent(raw: string | undefined): TraceContext | null {
	const match = TRACEPARENT.exec(raw?.trim() ?? "");
	if (!match) return null;
	const traceId = match[1]!;
	const spanId = match[2]!;
	if (ALL_ZERO.test(traceId) || ALL_ZERO.test(spanId)) return null;
	return { traceId, spanId };
}

/**
 * Build the OTLP/HTTP JSON body for one session-context record.
 *
 * Attribute-only by design: everything a consumer reads is an attribute, so
 * the record carries no body to parse. Trace and span ids are hex strings,
 * which is how the OTLP JSON encoding spells ids on the wire.
 */
export function buildSessionContextLogPayload({
	sessionId,
	agent,
	context,
	timeUnixNano,
	scopeVersion,
	trace,
	title,
	name,
}: {
	sessionId: string;
	agent: string;
	context: SessionContext;
	timeUnixNano: string;
	scopeVersion: string;
	trace?: TraceContext | null;
	/** The prompt-derived title, for agents whose telemetry carries none. */
	title?: string | null;
	/** The session's own name, as the harness itself holds it. */
	name?: string | null;
}): OtlpLogsPayload {
	const attributes: OtlpKeyValue[] = [
		attribute({ key: "event.name", value: SESSION_CONTEXT_EVENT_NAME }),
		attribute({ key: "session.id", value: sessionId }),
		attribute({ key: "coding_agent.name", value: agent }),
	];
	if (context.repository) {
		attributes.push(
			attribute({ key: "vcs.repository.host", value: context.repository.host }),
			attribute({
				key: "vcs.repository.owner",
				value: context.repository.owner,
			}),
			attribute({ key: "vcs.repository.name", value: context.repository.name }),
		);
	}
	if (context.branch) {
		attributes.push(
			attribute({ key: "vcs.ref.head.name", value: context.branch }),
		);
	}
	if (context.worktree) {
		attributes.push(
			attribute({ key: "vcs.worktree.name", value: context.worktree }),
		);
	}
	if (title) {
		attributes.push(attribute({ key: SESSION_TITLE_ATTR, value: title }));
	}
	if (name) {
		attributes.push(attribute({ key: SESSION_NAME_ATTR, value: name }));
	}

	return {
		resourceLogs: [
			{
				resource: {
					attributes: [attribute({ key: "service.name", value: SERVICE_NAME })],
				},
				scopeLogs: [
					{
						scope: { name: SESSION_CONTEXT_SCOPE_NAME, version: scopeVersion },
						logRecords: [
							{
								timeUnixNano,
								severityNumber: SEVERITY_INFO,
								severityText: "INFO",
								eventName: SESSION_CONTEXT_EVENT_NAME,
								attributes,
								...(trace
									? { traceId: trace.traceId, spanId: trace.spanId }
									: {}),
							},
						],
					},
				],
			},
		],
	};
}

function attribute({
	key,
	value,
}: {
	key: string;
	value: string;
}): OtlpKeyValue {
	return { key, value: { stringValue: value } };
}
