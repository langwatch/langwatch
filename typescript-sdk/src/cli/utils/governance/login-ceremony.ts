/**
 * Render the "You're in!" ceremony emitted by `langwatch login` after a
 * successful device-flow exchange.
 *
 * Two clearly-separated lists, sourced from the org's AI Tools catalog:
 *
 *   ✓ Logged in as jane@acme.com @ Acme
 *
 *   Your AI tools (run any of these):
 *     $ langwatch claude   # Claude Code
 *     $ langwatch codex    # Codex
 *
 *   Model providers you can issue a virtual key for:
 *     • anthropic   Claude
 *     • openai      (not configured yet)
 *
 *   Monthly budget: $500   |   Used: $0.00
 *
 *   Or open the app in your browser:
 *     $ langwatch open
 *
 * The two sections answer two different questions: which coding assistants
 * can I run right now (`tools`), and which model providers can I mint my own
 * virtual key for (`providers`). They are NOT the same thing — conflating
 * them was the bug this rewrite fixes.
 *
 * Pure function: takes the data, returns an array of lines. Caller applies
 * any chalk colouring + writes to stdout. Lets unit tests assert on the
 * literal output without colour/escape noise.
 */

export interface LoginCeremonyTool {
  /** CLI slug the wrapper runs (e.g. "claude", "codex"). */
  slug: string;
  /** Human-readable assistant name (e.g. "Claude Code"). */
  displayName: string;
}

export interface LoginCeremonyProvider {
  /** Provider key (lowercase, e.g. "anthropic", "openai", "gemini"). */
  name: string;
  /** Optional human-readable provider label (e.g. "Anthropic"). */
  displayName?: string;
  /**
   * Whether the org has a live credential for this provider. When false the
   * ceremony annotates the row so the user knows the tile still needs setup
   * before a minted key will work.
   */
  configured?: boolean;
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
  /**
   * Coding assistants the user can run via `langwatch <slug>`, sourced from
   * the org's catalog. When empty / omitted the ceremony falls back to the
   * built-in default wrappers so a fresh org still gets a next-step.
   */
  tools?: LoginCeremonyTool[];
  /** Model providers the user can mint their own virtual key for. */
  providers?: LoginCeremonyProvider[];
  budget?: LoginCeremonyBudget;
  /** Whether the `langwatch open` browser-launch command is available. */
  openCommand?: boolean;
}

/** Fallback wrappers when the org has not published any coding-assistant tile. */
const DEFAULT_TOOLS: LoginCeremonyTool[] = [
  { slug: "claude", displayName: "Claude Code" },
  { slug: "codex", displayName: "Codex" },
  { slug: "cursor", displayName: "Cursor" },
];

function padRight(s: string, width: number): string {
  if (s.length >= width) return s;
  return s + " ".repeat(width - s.length);
}

function formatUsd(n: number): string {
  // $500 (whole) → "$500"; $42.18 → "$42.18".
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

  // AI tools (coding assistants). Fall back to the built-in wrappers when the
  // org published none, so the user always gets a runnable next-step.
  const tools =
    input.tools && input.tools.length > 0 ? input.tools : DEFAULT_TOOLS;
  lines.push("");
  lines.push("Your AI tools (run any of these):");
  const cmdWidth = Math.max(
    ...tools.map((t) => `langwatch ${t.slug}`.length),
  );
  for (const tool of tools) {
    const cmd = `langwatch ${tool.slug}`;
    const labelSuffix = tool.displayName ? `  # ${tool.displayName}` : "";
    lines.push(`  $ ${padRight(cmd, cmdWidth)}${labelSuffix}`);
  }

  // Model providers the user can mint a virtual key for — a different concept
  // from the tools above. Only shown when the org published provider tiles.
  if (input.providers && input.providers.length > 0) {
    lines.push("");
    lines.push("Model providers you can issue a virtual key for:");
    const nameWidth = Math.max(...input.providers.map((p) => p.name.length));
    for (const p of input.providers) {
      const padded = padRight(p.name, nameWidth);
      const annotations: string[] = [];
      if (p.displayName && p.displayName !== p.name) {
        annotations.push(p.displayName);
      }
      if (p.configured === false) annotations.push("(not configured yet)");
      const suffix = annotations.length > 0 ? `  ${annotations.join("  ")}` : "";
      lines.push(`  • ${padded}${suffix}`);
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

  if (input.openCommand !== false) {
    lines.push("");
    lines.push("Or open the app in your browser:");
    lines.push("  $ langwatch open");
  }

  return lines;
}
