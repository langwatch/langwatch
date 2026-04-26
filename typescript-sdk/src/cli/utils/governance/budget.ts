/**
 * Pre-exec budget probe + Screen-8 ASCII renderer for the langwatch
 * wrappers (`langwatch claude` / `codex` / `cursor` / `gemini`).
 *
 * Per `specs/ai-gateway/governance/budget-exceeded.feature`: before
 * any wrapped command exec's the underlying tool, the CLI hits
 * `GET /api/auth/cli/budget/status`. On 402, render the spec
 * canonical box and exit 2 (configuration / quota error) without
 * spawning the tool.
 */

import { GovernanceConfig } from "./config";

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
 * Returns the 402 payload if the user is currently blocked, null
 * otherwise. 404 is treated as "older self-hosted server doesn't
 * expose this endpoint yet — pass through" so the CLI degrades
 * gracefully against legacy deploys. Network/5xx/etc. also
 * pass-through (the gateway's own 402 will surface via the wrapped
 * tool's error rendering as a fallback).
 */
export async function checkBudget(
  cfg: GovernanceConfig,
  opts: CheckBudgetOptions = {},
): Promise<BudgetExceededPayload | null> {
  if (!cfg.access_token) return null;
  const f = opts.fetchImpl ?? fetch;
  const url = cfg.control_plane_url.replace(/\/+$/, "") + "/api/auth/cli/budget/status";
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
 * Spec-canonical Screen-8 box. ASCII only — no ANSI codes — so
 * piping `langwatch claude | tee log` doesn't litter the log with
 * escape sequences. Lines match the budget-exceeded.feature
 * scenario character-for-character.
 */
export function renderBudgetExceeded(e: BudgetExceededPayload): string {
  const period = e.period || "month";
  const lines: string[] = [];
  lines.push("⚠  Budget limit reached");
  lines.push("");
  lines.push(`   You've used $${e.spent_usd} of your $${e.limit_usd} ${period}ly budget.`);
  lines.push("   To continue, ask your team admin to raise your limit.");
  lines.push("");
  if (e.admin_email) {
    lines.push(`   Admin: ${e.admin_email}`);
    lines.push("");
  }
  lines.push("   Need urgent access? Run:");
  lines.push("     langwatch request-increase");
  return lines.join("\n") + "\n";
}
