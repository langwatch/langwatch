/**
 * Pre-exec budget probe + Screen-8 ASCII renderer for the langwatch wrappers.
 * Per `specs/ai-gateway/governance/budget-exceeded.feature`: on a 402 from
 * `GET /api/auth/cli/budget/status`, render the box and exit 2, no spawn.
 */

import { normalizeEndpoint } from "../../../internal/endpoint";
import { type GovernanceConfig } from "./config";

export interface BudgetExceededPayload {
  type: string;
  scope: "user" | "team" | "org" | "project";
  limit_usd: string;
  spent_usd: string;
  period: string; // "month" | "week" | "day" | ...
  request_increase_url?: string;
  admin_email?: string;
}

export interface CheckBudgetOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Returns the 402 payload if blocked, null otherwise. 404 passes through
 * (older self-hosted server), as do network/5xx -- the gateway's own 402
 * surfaces via the tool's error rendering as fallback.
 */
export async function checkBudget(
  cfg: GovernanceConfig,
  opts: CheckBudgetOptions = {},
): Promise<BudgetExceededPayload | null> {
  if (!cfg.access_token) return null;
  const f = opts.fetchImpl ?? fetch;
  const url = normalizeEndpoint(cfg.control_plane_url) + "/api/auth/cli/budget/status";
  let res: Response;
  try {
    res = await f(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${cfg.access_token}`,
        Accept: "application/json",
      },
    });
  } catch {
    return null; // network error — never block the user on this check
  }
  if (res.status === 200) return null;
  if (res.status === 404) return null; // older server, no endpoint yet
  if (res.status === 402) {
    try {
      const body = (await res.json()) as { error?: BudgetExceededPayload };
      if (body.error?.type && body.error.scope) return body.error;
    } catch {
      // malformed payload — fall through, let the underlying tool's
      // error render whatever the gateway returns
    }
  }
  return null;
}

/**
 * Spec-canonical Screen-8 box: ASCII only (no ANSI) so piping doesn't corrupt
 * logs; lines match the budget-exceeded.feature scenario verbatim.
 */

// Naive `${period}ly` produces "dayly"/"totally"; the gateway's lowercase
// enum periods are mapped explicitly instead. Unknown periods fall through
// to the raw value rather than render gibberish.
const PERIOD_LABEL: Record<string, string> = {
  minute: "per-minute",
  hour: "hourly",
  day: "daily",
  week: "weekly",
  month: "monthly",
  total: "total",
};

export function renderBudgetExceeded(
  e: BudgetExceededPayload,
  { fallbackUrl }: { fallbackUrl?: string } = {},
): string {
  const period = (e.period || "month").toLowerCase();
  const periodLabel = PERIOD_LABEL[period] ?? period;
  const lines: string[] = [];
  lines.push("⚠  Budget limit reached");
  lines.push("");
  lines.push(`   You've used $${e.spent_usd} of your $${e.limit_usd} ${periodLabel} budget.`);
  lines.push("   To continue, ask your team admin to raise your limit.");
  lines.push("");
  if (e.admin_email) {
    lines.push(`   Admin: ${e.admin_email}`);
    lines.push("");
  }
  // The gateway-signed URL carries the scope/limit/spent params so the
  // request form arrives pre-filled; the static page is the fallback.
  // An empty payload URL falls back too, so `??` would be wrong here.
  const signedUrl = e.request_increase_url?.trim();
  let requestUrl = fallbackUrl;
  if (signedUrl !== undefined && signedUrl !== "") requestUrl = signedUrl;
  if (requestUrl) {
    lines.push("   Need urgent access? Request an increase:");
    lines.push(`     ${requestUrl}`);
  }
  return lines.join("\n") + "\n";
}
