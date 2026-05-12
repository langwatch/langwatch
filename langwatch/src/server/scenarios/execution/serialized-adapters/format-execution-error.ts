/**
 * Shared error formatting for serialized agent adapters.
 *
 * The previous error surface was a single blob — adapter wrapper + Python
 * stderr + AI SDK warnings + OTEL flush notices — with no structure. This
 * module separates failures by source and trims noise so the surfaced error
 * tells you *where* the failure happened and *why*. See #3439.
 *
 * Truncation keeps the surfaced message bounded so the scenarios UI does not
 * have to render a 60kb traceback inline. The raw detail is preserved on the
 * error so deeper diagnostics can still pull it.
 */

const MAX_DETAIL_CHARS = 2000;

/** Identifies who actually broke. */
export type ExecutionErrorSource =
  | "user_code"
  | "nlp_service"
  | "network"
  | "timeout";

interface ExecutionErrorInit {
  adapter: string | undefined;
  source: ExecutionErrorSource;
  message: string;
  rawDetail?: string;
  httpStatusCode?: number;
  endpoint?: string;
}

export class SerializedAdapterError extends Error {
  readonly source: ExecutionErrorSource;
  readonly httpStatusCode: number | undefined;
  readonly endpoint: string | undefined;
  readonly rawDetail: string | undefined;

  constructor(init: ExecutionErrorInit) {
    super(buildSurfacedMessage(init));
    this.name = "SerializedAdapterError";
    this.source = init.source;
    this.httpStatusCode = init.httpStatusCode;
    this.endpoint = init.endpoint;
    this.rawDetail = init.rawDetail;
  }
}

function buildSurfacedMessage(init: ExecutionErrorInit): string {
  const label = sourceLabel(init.source);
  const adapter = `[${init.adapter ?? "adapter"}]`;
  const summary = init.message;
  if (!init.rawDetail) return `${label} ${adapter} ${summary}`;

  const cleaned = cleanErrorDetail(init.rawDetail);
  if (!cleaned) return `${label} ${adapter} ${summary}`;

  const truncated =
    cleaned.length > MAX_DETAIL_CHARS
      ? `${cleaned.slice(0, MAX_DETAIL_CHARS)}\n[...truncated ${
          cleaned.length - MAX_DETAIL_CHARS
        } chars]`
      : cleaned;
  return `${label} ${adapter} ${summary}\n\n${truncated}`;
}

function sourceLabel(source: ExecutionErrorSource): string {
  switch (source) {
    case "user_code":
      return "[user code]";
    case "nlp_service":
      return "[nlp service]";
    case "network":
      return "[adapter]";
    case "timeout":
      return "[adapter]";
  }
}

/**
 * Strip noise that does not belong on the surfaced error:
 *   - AI SDK compat-mode warnings (unrelated to the actual failure)
 *   - OTEL flush notices ("Flushing OTEL traces...", "OTEL traces flushed")
 *   - ANSI colour escapes
 *
 * Preserves the underlying Python traceback / HTTP context — that's the
 * actually useful part.
 */
export function cleanErrorDetail(raw: string): string {
  const lines = stripAnsi(raw).split(/\r?\n/);
  const cleaned: string[] = [];
  for (const line of lines) {
    if (isNoisyLine(line)) continue;
    cleaned.push(line);
  }
  return cleaned.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function isNoisyLine(line: string): boolean {
  if (/AI SDK Warning/i.test(line)) return true;
  if (/Flushing OTEL traces/i.test(line)) return true;
  if (/OTEL traces flushed/i.test(line)) return true;
  return false;
}

const ANSI_PATTERN = /\x1b\[[0-9;]*[A-Za-z]/g;

function stripAnsi(input: string): string {
  return input.replace(ANSI_PATTERN, "");
}

/**
 * Classify an HTTP failure into a user-code vs nlp-service source. The NLP
 * service surfaces user Python errors as 500 with a structured detail string
 * (often containing "Traceback (most recent call last)") — those are the
 * user's bug, not ours. Other 5xx without that signal point at the service
 * itself.
 */
export function classifyHttpFailure(
  status: number,
  detail: string | undefined,
): "user_code" | "nlp_service" {
  if (!detail) return "nlp_service";
  if (status === 500 && /traceback|Error: |Exception/i.test(detail)) {
    return "user_code";
  }
  return "nlp_service";
}
