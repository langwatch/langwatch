/**
 * Render the Storyboard Screen 4 "You're in!" ceremony emitted by
 * `langwatch login --device` after a successful device-flow exchange.
 *
 * Per gateway.md storyboard:
 *
 *   ✓ Logged in as jane@acme.com
 *
 *   Your AI tools are ready:
 *     • anthropic    (Claude — Sonnet, Haiku)
 *     • openai       (GPT-5, GPT-5-mini)
 *     • gemini       (2.5 Pro, 2.5 Flash)
 *
 *   Monthly budget: $500   |   Used: $0.00
 *
 *   Try it:
 *     $ langwatch claude        # use Claude Code
 *     $ langwatch codex         # use Codex
 *     $ langwatch cursor        # use Cursor
 *
 *   Or open your dashboard:
 *     $ langwatch dashboard
 *
 * Phase 1B.5 task 1.5a-cli-1 from PR #3524's Personal-Key Journey
 * section. Provider list + budget are OPTIONAL — when the backend
 * doesn't have a bootstrap endpoint to surface them yet (follow-up
 * task), the ceremony gracefully degrades to the email + try-it
 * sections, which still gives the user the next-step affordance.
 *
 * Pure function: takes the data, returns an array of lines. Caller
 * applies any chalk colouring + writes to stdout. Lets unit tests
 * assert on the literal output without colour/escape noise.
 */

export interface LoginCeremonyProvider {
  /** Provider key (lowercase, e.g. "anthropic", "openai", "gemini"). */
  name: string;
  /** Optional human-readable summary of available models. */
  modelSummary?: string;
}

export interface LoginCeremonyBudget {
  /** Period label (e.g. "Monthly"). Capitalised in output. */
  period: string;
  /** Spend ceiling in USD (rendered as `$N`). */
  limitUsd: number;
  /** Used so far in USD (rendered with two decimals). */
  usedUsd: number;
}

export interface LoginCeremonyInput {
  email: string;
  organizationName?: string;
  providers?: LoginCeremonyProvider[];
  budget?: LoginCeremonyBudget;
  /** Wrappers shipped today (claude / codex / cursor / gemini-cli /
   *  generic shell). Caller decides which subset to surface. */
  wrappers?: string[];
  /** Whether the `langwatch dashboard` command is available. */
  dashboardCommand?: boolean;
}

const DEFAULT_WRAPPERS = ["claude", "codex", "cursor"] as const;

const WRAPPER_LABELS: Record<string, string> = {
  claude: "use Claude Code",
  codex: "use Codex",
  cursor: "use Cursor",
  "gemini-cli": "use Gemini CLI",
  shell: "open a shell with gateway env vars",
};

function padRight(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function formatUsd(n: number): string {
  // $500 (whole) → "$500"; $42.18 → "$42.18"; preserves the
  // storyboard's mixed-precision treatment (limit shown rounded,
  // used always two-dp).
  if (Number.isInteger(n)) return `$${n}`;
  return `$${n.toFixed(2)}`;
}

function formatUsedUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function formatLoginCeremony(input: LoginCeremonyInput): string[] {
  const lines: string[] = [];

  const orgSuffix = input.organizationName ? ` @ ${input.organizationName}` : "";
  lines.push(`✓ Logged in as ${input.email}${orgSuffix}`);

  if (input.providers && input.providers.length > 0) {
    lines.push("");
    lines.push("Your AI tools are ready:");
    const nameWidth = Math.max(
      ...input.providers.map((p) => p.name.length),
    );
    for (const p of input.providers) {
      const padded = padRight(p.name, nameWidth);
      const summary = p.modelSummary ? `  (${p.modelSummary})` : "";
      lines.push(`  • ${padded}${summary}`);
    }
  }

  if (input.budget) {
    lines.push("");
    const period =
      input.budget.period.charAt(0).toUpperCase() +
      input.budget.period.slice(1).toLowerCase();
    lines.push(
      `${period} budget: ${formatUsd(input.budget.limitUsd)}   |   Used: ${formatUsedUsd(input.budget.usedUsd)}`,
    );
  }

  const wrappers =
    input.wrappers && input.wrappers.length > 0
      ? input.wrappers
      : Array.from(DEFAULT_WRAPPERS);
  lines.push("");
  lines.push("Try it:");
  const cmdWidth = Math.max(
    ...wrappers.map((w) => `langwatch ${w}`.length),
  );
  for (const w of wrappers) {
    const cmd = `langwatch ${w}`;
    const label = WRAPPER_LABELS[w];
    const labelSuffix = label ? `  # ${label}` : "";
    lines.push(`  $ ${padRight(cmd, cmdWidth)}${labelSuffix}`);
  }

  if (input.dashboardCommand !== false) {
    lines.push("");
    lines.push("Or open your dashboard:");
    lines.push("  $ langwatch dashboard");
  }

  return lines;
}
