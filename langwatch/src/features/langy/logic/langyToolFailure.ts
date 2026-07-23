/**
 * Reading a failed tool frame into card copy.
 *
 * A tool frame reports its failure as ONE string — the CLI's `--format json`
 * document if we are lucky, arbitrary stderr if we are not — and several cards
 * need the same answer out of it. So the reading lives here, once, and the
 * components only draw the result.
 *
 * Three levels, and the card must say something useful at every one:
 *
 *   1. PARSED AND KNOWN. The document named a failure this module has copy for
 *      (an access denial, a plan limit). The headline is that copy; the code
 *      still rides underneath as visible detail.
 *   2. PARSED, CODE UNKNOWN. The headline is the platform's own sentence — it
 *      was written for a user and is more specific than anything derivable here
 *      — and the code names itself underneath.
 *   3. UNPARSEABLE. Whatever text there is, shown. A card that knows the cause
 *      and declines to say it is the failure being fixed here.
 *
 * The code is NEVER the headline. `resource_limit_exceeded` is our vocabulary,
 * not the customer's (dev/docs/best_practices/copywriting.md), so the headline
 * says the project's plan includes 3 scenarios and all 3 are in use, and the
 * code sits below it in mono where it can be selected, searched and pasted into
 * a support thread.
 *
 * @see specs/langy/langy-cli-tool-envelope.feature
 *      "A failure keeps its structure all the way to the card"
 */
import {
  parseCliJson,
  readCliErrorDocument,
  isTerminalFailure,
  type CliHandledError,
} from "@langwatch/langy";
import { LIMIT_TYPE_LABELS } from "~/server/license-enforcement/constants";

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
   * The one specific fact behind the message — the access that was missing, the
   * field that was wrong. A DETAIL, deliberately: it is the answer to "which
   * one?", not the headline, because the headline has to make sense to someone
   * who has never seen our permission names.
   */
  detail?: string;
  /**
   * The platform's own discriminant, shown verbatim.
   *
   * Present whenever the failure carried one, INCLUDING the codes this module
   * has no copy for — a code that names itself beats "This step couldn't be
   * completed", which is what an unmapped failure used to render as.
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
    return url.protocol === "http:" || url.protocol === "https:"
      ? url.toString()
      : undefined;
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
 *
 * Our permission names are internal vocabulary, so they never headline a card.
 * They do answer the one question the user has next — access to WHAT? — so the
 * reading of them belongs in a detail line, in plain words.
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
 *
 * A WHITELIST, and it used to be a status check — `httpStatus === 403` — which
 * is how a plan limit came to be reported as a permissions problem. 403 is the
 * platform's word for "no", and it says no for several different reasons: the
 * key lacks the permission, the plan lacks the allowance, a guardrail blocked
 * the content. Only the first of those is about access, and only the first has
 * a sentence written for whoever holds the credential ("API Key does not grant
 * required permission: scenarios:manage") rather than for the person reading
 * the panel. Every other 403 keeps its own sentence, which is both honest and
 * more specific than anything this module could substitute.
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
 *
 * Both carry `{ limitType, current, max }`; they are two codes only because one
 * counts in Postgres and the other in ClickHouse, which is not a distinction
 * anybody reading a card should have to care about.
 */
const PLAN_LIMIT_CODES = new Set([
  "resource_limit_exceeded",
  "scenario_set_limit_exceeded",
]);

const normalizedCode = (domain: CliHandledError): string =>
  domain.code.trim().toLowerCase();

const isAccessDenial = (domain: CliHandledError): boolean =>
  ACCESS_DENIAL_CODES.has(normalizedCode(domain));

const asCount = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;

/** What ran out, named the way the customer names it. */
function limitLabel(limitType: unknown): string | undefined {
  if (typeof limitType !== "string" || limitType.trim().length === 0) {
    return undefined;
  }
  return (
    LIMIT_TYPE_LABELS[limitType as keyof typeof LIMIT_TYPE_LABELS] ??
    humanResource(limitType)
  );
}

/** The plan allowance behind a failure, or null when it was not one. */
function readPlanLimit(
  domain: CliHandledError,
): LangyToolFailureLimit | null {
  if (!PLAN_LIMIT_CODES.has(normalizedCode(domain))) return null;
  const label = limitLabel(domain.meta.limitType);
  if (!label) return null;
  return {
    label,
    type: String(domain.meta.limitType),
    ...(asCount(domain.meta.current) !== undefined
      ? { current: asCount(domain.meta.current)! }
      : {}),
    ...(asCount(domain.meta.max) !== undefined
      ? { max: asCount(domain.meta.max)! }
      : {}),
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
 *
 * An access denial and a plan limit get copy of our own, for the same reason in
 * both cases: the platform's sentence is written for somebody else. The denial's
 * names an API key the reader never issued and a permission in our vocabulary;
 * the limit's ends in an absolute URL to a settings page the reader may not even
 * be allowed to open, which the card replaces with a real action. Everything
 * else keeps the platform's own sentence, including the infrastructure failures:
 * it was written for a user, it is more specific than anything derivable here,
 * and replacing it would lose information the person reading the card actually
 * wants ("socket hang up" beats "something went wrong").
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
    // ONE sentence for the fact, one for what to do. It used to say "Your
    // access in this project doesn't cover this action." and then, underneath,
    // "Needs permission to manage scenarios." — the same fact twice at two
    // altitudes — and then a third line telling the reader to re-create an API
    // key, which is advice for somebody who is not here.
    //
    // "You can't X here", not "you don't have permission to X". The difference
    // matters and the response cannot settle it: the platform checks
    // `effective = key ∩ user`, and a denial means the INTERSECTION was empty.
    // That is usually the caller genuinely lacking the permission, but it is
    // also what a key whose candidate list omits a permission the caller DOES
    // hold looks like — a bug on our side, and one we have shipped. The wire
    // carries `{ permission, apiKeyId, userId, projectId }` and nothing that
    // separates the two, so the card states the consequence, which is true
    // either way, rather than a cause it cannot substantiate.
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

  // Level 3. No document, so no code — but there is usually TEXT, and the text
  // is the only thing left that knows anything. Showing it beats "This step
  // couldn't be completed", which tells the reader nothing and tells support
  // less. Matching our own English on the way past was tried and removed: it
  // pins the copy to a regex, breaks the moment the sentence is reworded, and
  // hides the real defect (whoever dropped the document) instead of fixing it.
  if (!domain) {
    return {
      title: `${title} failed`,
      message: "This step couldn't be completed.",
      ...(raw ? { detail: firstLine(raw), raw } : {}),
    };
  }

  // New-CLI documents carry the trace links top-level on the error; documents
  // written by an older CLI keep them nested under `meta.trace` (the shared
  // REST handler's wire shape). Prefer the top-level fields, fall back to the
  // nested block so old documents keep their trace/logs actions.
  const trace = asRecord(domain.meta.trace);
  const traceId =
    domain.traceId ??
    (typeof trace?.traceId === "string" ? trace.traceId : undefined);
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
    // The platform's own next steps (ADR-045's remediation channel), shown as
    // written — paraphrasing them here would put the card out of step with the
    // docs they are pinned to.
    //
    // But only when they are addressed to THIS reader. That channel is authored
    // for an API consumer holding their own key, and it shows: an access denial
    // comes back saying "re-create the API key with the required scope", linked
    // to the API-keys reference. Nobody chatting in this panel issued a key —
    // Langy mints its own — so that is a line of advice for somebody who is not
    // here, sitting on a card that was already saying enough. A field arriving
    // on the wire is not a reason to render it; whether it helps the person
    // reading THIS surface is.
    ...(remediationApplies && domain.suggestions?.length
      ? { tips: domain.suggestions }
      : {}),
    ...(remediationApplies && docsUrl ? { docsUrl } : {}),
    ...(traceId ? { traceId } : {}),
    ...(traceUrl ? { traceUrl } : {}),
    ...(logsUrl ? { logsUrl } : {}),
    ...(raw ? { raw } : {}),
  };
}

/** The most informative single line of an unstructured failure. */
function firstLine(raw: string): string {
  const lines = raw.split("\n").map((line) => line.trim());
  const named = lines.find((line) =>
    /failed to|request failed|error|self_signed_cert_in_chain/i.test(line),
  );
  const line = named ?? lines.find((part) => part.length > 0) ?? raw;
  return line.replace(/^✖\s*/, "").trim().slice(0, 300);
}
