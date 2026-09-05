/**
 * Reading a failed tool frame into card copy.
 * @see specs/langy/langy-cli-tool-envelope.feature
 *      "A failure keeps its structure all the way to the card"
 */
import {
  type CliHandledError,
  isTerminalFailure,
  parseCliJson,
  readCliErrorDocument,
} from "@langwatch/langy-contract";
import { LIMIT_TYPE_LABELS } from "../../../../model/limit-type-labels";

/** The plan allowance a failure ran into, in the customer's own words. */
export interface LangyToolFailureLimit {
  /** What ran out — "scenarios", "team members". Never `limitType`. */
  label: string;
  /**
   * The platform's own name for it. NEVER shown: it exists so the upgrade the
   * card offers lands in the same conversion funnel as every other upgrade
   * prompt, which is keyed by this (`<limitType>_limit_reached`).
   */
  type: string;
  /** How many are in use, when the platform said. */
  current?: number;
  /** How many the plan includes, when the platform said. */
  max?: number;
}

export interface LangyToolErrorPresentation {
  title: string;
  message: string;
  /**
   * The one specific fact behind the message — the access that was missing, the field
   * that was wrong.
   */
  detail?: string;
  /**
   * The platform's own discriminant, shown verbatim.
   */
  code?: string;
  /**
   * What the plan allows, when the failure was a plan limit rather than a
   * permission problem. The card turns this into an upgrade path.
   */
  limit?: LangyToolFailureLimit;
  /** True when no retry and no different arguments will change the answer. */
  terminal?: boolean;
  /** What the user can do about it, in the platform's own words. */
  tips?: string[];
  docsUrl?: string;
  traceId?: string;
  traceUrl?: string;
  logsUrl?: string;
  /** The whole failure, verbatim, for pasting into a support thread. */
  raw?: string;
}

type RecordValue = Record<string, unknown>;

function asRecord(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RecordValue)
    : null;
}

function safeHttpUrl(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function readStructuredError(errorText: unknown): CliHandledError | null {
  if (typeof errorText === "string") {
    // Shell tools merge stderr with stdout. parseCliJson extracts the first
    // balanced JSON document, so a CLI error remains readable even when a
    // one-line human error was printed beside it.
    return readCliErrorDocument(parseCliJson(errorText));
  }
  return readCliErrorDocument(errorText);
}

/** Everything a frame gave us, as text, with terminal escapes stripped. */
function rawFailureText(errorText: unknown): string | undefined {
  const value = asRecord(errorText);
  const text =
    typeof errorText === "string"
      ? errorText
      : typeof value?.text === "string"
        ? value.text
        : value
          ? safeStringify(value)
          : undefined;
  if (!text) return undefined;
  const cleaned = text.replace(/\u001b\[[0-9;]*m/g, "").trim();
  return cleaned.length > 0 ? cleaned : undefined;
}

function safeStringify(value: unknown): string | undefined {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return undefined;
  }
}

/** `gatewayBudgets` / `virtual_keys` → "gateway budgets" / "virtual keys". */
function humanResource(resource: string): string {
  return resource
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]/g, " ")
    .toLowerCase();
}

/** The action half of a permission, in words a customer already uses. */
const ACTION_WORDS: Record<string, string> = {
  view: "view",
  create: "create",
  update: "edit",
  delete: "delete",
  manage: "manage",
  share: "share",
  rotate: "rotate",
  attach: "attach",
  detach: "detach",
};

/**
 * `scenarios:manage` → "manage scenarios".
 */
function humanPermission(permission: unknown): string | undefined {
  if (typeof permission !== "string") return undefined;
  const [resource, action] = permission.split(":");
  if (!resource || !action) return undefined;
  const verb = ACTION_WORDS[action];
  if (!verb) return undefined;
  return `${verb} ${humanResource(resource)}`;
}

/**
 * The codes that mean "your credential does not carry this".
 */
const ACCESS_DENIAL_CODES = new Set([
  "api_key_permission_denied",
  "api_key_not_owned",
  "api_key_scope_violation",
  // The CLI's own status-derived codes, for a 401/403 that carried no body.
  "unauthorized",
  "forbidden",
]);

/**
 * The codes that mean "your plan does not include any more of these".
 */
const PLAN_LIMIT_CODES = new Set(["resource_limit_exceeded"]);

const normalizedCode = (domain: CliHandledError): string => domain.code.trim().toLowerCase();

const isAccessDenial = (domain: CliHandledError): boolean =>
  ACCESS_DENIAL_CODES.has(normalizedCode(domain));

const asCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;

/** What ran out, named the way the customer names it. */
function limitLabel(limitType: unknown): string | undefined {
  if (typeof limitType !== "string" || limitType.trim().length === 0) {
    return undefined;
  }
  return LIMIT_TYPE_LABELS[limitType as keyof typeof LIMIT_TYPE_LABELS] ?? humanResource(limitType);
}

/** The plan allowance behind a failure, or null when it was not one. */
function readPlanLimit(domain: CliHandledError): LangyToolFailureLimit | null {
  if (!PLAN_LIMIT_CODES.has(normalizedCode(domain))) return null;
  const label = limitLabel(domain.meta.limitType);
  if (!label) return null;
  return {
    label,
    type: String(domain.meta.limitType),
    ...(asCount(domain.meta.current) !== undefined
      ? { current: asCount(domain.meta.current)! }
      : {}),
    ...(asCount(domain.meta.max) !== undefined ? { max: asCount(domain.meta.max)! } : {}),
  };
}

/** "Your plan includes 3 scenarios, and all 3 are in use." */
function limitSentence(limit: LangyToolFailureLimit): string {
  if (limit.max === undefined) {
    return `Your plan doesn't include any more ${limit.label}.`;
  }
  if (limit.current === undefined || limit.current >= limit.max) {
    return `Your plan includes ${limit.max} ${limit.label}, and all ${limit.max} are in use.`;
  }
  return `You're using ${limit.current} of the ${limit.max} ${limit.label} your plan includes.`;
}

/**
 * What to SAY about a failure.
 */
function describeFailure(domain: CliHandledError): {
  message: string;
  detail?: string;
  limit?: LangyToolFailureLimit;
  /**
   * Whether the platform's own next steps belong on THIS card. See
   * {@link presentLangyToolError}.
   */
  remediationApplies: boolean;
} {
  const limit = readPlanLimit(domain);
  if (limit) {
    return { message: limitSentence(limit), limit, remediationApplies: false };
  }

  if (isAccessDenial(domain)) {
    // ONE sentence for the fact, one for what to do.
    const needed = humanPermission(domain.meta.permission);
    return {
      message: needed
        ? `You can't ${needed} in this project.`
        : "This action isn't available to you in this project.",
      // The one next step that is true for this reader. They did not issue the
      // key Langy acts through and cannot re-scope it — the system mints it
      // from their own permissions — so the only thing they can do is ask
      // whoever grants those. Never a link: a settings page would refuse them,
      // which is a dead end dressed up as a way forward.
      detail: "Ask whoever manages access for your team if you need it.",
      remediationApplies: false,
    };
  }

  return { message: domain.message, remediationApplies: true };
}

/**
 * Turn a failed tool frame into safe, structured card copy.
 *
 * @see the three levels in this module's header.
 */
export function presentLangyToolError({
  title,
  errorText,
}: {
  title: string;
  errorText: unknown;
}): LangyToolErrorPresentation {
  const raw = rawFailureText(errorText);
  const domain = readStructuredError(errorText);

  // Level 3. No document, so no code — but there is usually TEXT, and the text is the
  // only thing left that knows anything. Showing it beats "This step couldn't be
  // completed", which tells the reader nothing and tells support less.
  if (!domain) {
    // ...unless the text is a traceback. A traceback is the engine talking to itself: a
    // file path, a line number and an exception class from inside a process, none of it
    // written for a reader (dev/docs/best_practices/error-handling.md).
    const detail = raw && !isEngineTraceback(raw) ? firstLine(raw) : undefined;
    return {
      title: `${title} failed`,
      message: "This step couldn't be completed.",
      ...(detail ? { detail } : {}),
      ...(raw ? { raw } : {}),
    };
  }

  // New-CLI documents carry the trace links top-level on the error; documents
  // written by an older CLI keep them nested under `meta.trace` (the shared
  // REST handler's wire shape). Prefer the top-level fields, fall back to the
  // nested block so old documents keep their trace/logs actions.
  const trace = asRecord(domain.meta.trace);
  const traceId =
    domain.traceId ?? (typeof trace?.traceId === "string" ? trace.traceId : undefined);
  const traceUrl = safeHttpUrl(domain.traceUrl) ?? safeHttpUrl(trace?.traceUrl);
  const logsUrl = safeHttpUrl(domain.logsUrl) ?? safeHttpUrl(trace?.logsUrl);
  const docsUrl = safeHttpUrl(domain.docUrl);
  const { message, detail, limit, remediationApplies } = describeFailure(domain);

  return {
    title: `${title} failed`,
    message,
    ...(detail ? { detail } : {}),
    // Levels 1 and 2 alike. A code we have copy for still names itself, so the
    // reader can quote it; a code we do not is the only handle anyone has.
    code: domain.code,
    ...(limit ? { limit } : {}),
    ...(isTerminalFailure(domain) ? { terminal: true } : {}),
    // The platform's own next steps (ADR-045's remediation channel), shown as written —
    // paraphrasing them here would put the card out of step with the docs they are
    // pinned to.
    ...(remediationApplies && domain.suggestions?.length ? { tips: domain.suggestions } : {}),
    ...(remediationApplies && docsUrl ? { docsUrl } : {}),
    ...(traceId ? { traceId } : {}),
    ...(traceUrl ? { traceUrl } : {}),
    ...(logsUrl ? { logsUrl } : {}),
    ...(raw ? { raw } : {}),
  };
}

/**
 * The marks of a stack trace, in the two languages the tools we run are written in. Any
 * one of them is enough: a truncated traceback keeps its frames without its header, and
 * a process that printed only the exception line still printed an exception line.
 */
const TRACEBACK_SIGNALS = [
  /^\s*Traceback \(most recent call last\)/m,
  /^\s*File "[^"]+", line \d+/m,
  /^\s*at [\w$.<>[\] ]+ \(?[^\s]+:\d+:\d+\)?$/m,
  /^[A-Za-z_][\w.]*(?:Error|Exception|Warning)\s*:/m,
];

/** Whether raw failure text is a stack trace rather than a sentence. */
function isEngineTraceback(raw: string): boolean {
  return TRACEBACK_SIGNALS.some((signal) => signal.test(raw));
}

/** The most informative single line of an unstructured failure. */
function firstLine(raw: string): string {
  const lines = raw.split("\n").map((line) => line.trim());
  const named = lines.find((line) =>
    /failed to|request failed|error|self_signed_cert_in_chain/i.test(line),
  );
  const line = named ?? lines.find((part) => part.length > 0) ?? raw;
  return line
    .replace(/^✖\s*/, "")
    .trim()
    .slice(0, 300);
}
