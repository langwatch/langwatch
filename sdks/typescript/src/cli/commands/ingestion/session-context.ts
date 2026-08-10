/**
 * The pure half of `langwatch ingest hook <tool>`: everything needed to turn
 * a git checkout plus a hook payload into one OTLP log record, with no
 * process, filesystem or network access of its own.
 *
 * Kept separate from the command so each piece is directly testable, the
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
  repository: RepositoryIdentity;
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

function identityFrom(host: string, rawPath: string): RepositoryIdentity | null {
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
export function sessionContextFingerprint({
  repository,
  branch,
  worktree,
}: SessionContext): string {
  return `${repository.host}/${repository.owner}/${repository.name}@${branch ?? ""}#${worktree ?? ""}`;
}

/**
 * Parse `OTEL_EXPORTER_OTLP_HEADERS` (comma-separated `key=value` pairs, the
 * first `=` splitting the two) into a header map. A pair with no `=`, or an
 * empty key, is dropped rather than guessed at.
 */
export function parseOtlpHeaders(raw: string | undefined): Record<string, string> {
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
}: {
  sessionId: string;
  agent: string;
  context: SessionContext;
  timeUnixNano: string;
  scopeVersion: string;
  trace?: TraceContext | null;
}): OtlpLogsPayload {
  const attributes: OtlpKeyValue[] = [
    attribute({ key: "event.name", value: SESSION_CONTEXT_EVENT_NAME }),
    attribute({ key: "session.id", value: sessionId }),
    attribute({ key: "coding_agent.name", value: agent }),
    attribute({ key: "vcs.repository.host", value: context.repository.host }),
    attribute({ key: "vcs.repository.owner", value: context.repository.owner }),
    attribute({ key: "vcs.repository.name", value: context.repository.name }),
  ];
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

  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            attribute({ key: "service.name", value: SERVICE_NAME }),
          ],
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
