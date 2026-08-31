// Builds and upserts the sticky "coding agent usage" comment on a pull
// request, from the LangWatch pull-request usage API
// (GET /api/coding-agent/pull-request-usage): sessions, tokens and estimated
// cost per contributor and agent, plus a per-model breakdown, over the pull
// request's whole lifetime.
//
// Deliberately non-blocking, like pr-impact-map: this script only describes
// what the work cost, it never judges it. A LangWatch outage logs a warning
// and exits 0, so the job can sit on every pull request without ever
// painting a red X for a reporting failure.
//
// Deliberately dependency-free and run with `node --experimental-strip-types`,
// matching guard-path-filters.ts: there is no install step on the runner.
//
// Spec: specs/ci/pr-token-usage.feature

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const MARKER = "<!-- pr-token-usage -->";

/** The API refuses an unknown pull request with this code; it means "no usage
 * recorded yet", not "something broke". */
const PR_NOT_MAPPED_CODE = "github_pr_not_mapped";

export type UsageRow = {
  projectSlug: string;
  contributorLabel: string;
  contributorIsProject: boolean;
  agent: string;
  models: string[];
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

export type UsageTotals = {
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

export type ModelBreakdownRow = {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  costUsd: number | null;
};

export type PullRequestUsage = {
  rows: UsageRow[];
  totals: UsageTotals;
  modelBreakdown: ModelBreakdownRow[];
};

/** "No usage recorded" and "the PR is not mapped yet" collapse into null:
 * both mean there is nothing to say. */
export type FetchOutcome =
  | { kind: "usage"; usage: PullRequestUsage }
  | { kind: "none" }
  | { kind: "error"; message: string };

const AGENT_LABELS: Record<string, string> = {
  claude_code: "Claude Code",
  codex: "Codex",
  opencode: "OpenCode",
  cursor: "Cursor",
  gemini_cli: "Gemini CLI",
};

/** A known agent identifier renders as its product name; an unknown one falls
 * back to a readable form of itself rather than raw snake_case. */
export const agentLabel = (agent: string): string =>
  AGENT_LABELS[agent] ??
  agent
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");

/** Full numbers with separators: "2,603,257,062". Used for small counts. */
export const formatCount = (n: number): string => n.toLocaleString("en-US");

const COUNT_WORDS = ["thousand", "million", "billion", "trillion"];

/** Token counts render as words, not digits or letter abbreviations:
 * 2,603,257,062 is "2.6 billion". One decimal below one hundred of a unit,
 * none above; a value that rounds up to a whole next unit is promoted. */
export const humanizeCount = (n: number): string => {
  if (n < 1_000) return formatCount(n);
  let index = Math.min(Math.floor(Math.log10(n) / 3), COUNT_WORDS.length) - 1;
  const display = (i: number): string => {
    const value = n / 10 ** ((i + 1) * 3);
    return value >= 100 ? value.toFixed(0) : value.toFixed(1);
  };
  let digits = display(index);
  if (Number(digits) >= 1_000 && index < COUNT_WORDS.length - 1) {
    index += 1;
    digits = display(index);
  }
  return `${digits.replace(/\.0$/, "")} ${COUNT_WORDS[index]}`;
};

const AGENT_ICONS: Record<string, string> = {
  claude_code: "claude-code.svg",
  codex: "codex.svg",
  opencode: "opencode.svg",
  cursor: "cursor.svg",
  gemini_cli: "gemini.svg",
  github_copilot: "github-copilot.svg",
};

/** A known agent renders with its product icon before the name; an unknown
 * one renders as its label alone rather than a broken image. */
export const agentCell = (agent: string): string => {
  const icon = AGENT_ICONS[agent];
  const label = agentLabel(agent);
  return icon
    ? `<img src="https://app.langwatch.ai/images/external-icons/${icon}" width="14" height="14" /> ${label}`
    : label;
};

/** null cost means the caller may not price this row — an em dash, not $0. */
export const formatCost = (cost: number | null): string =>
  cost === null ? "—" : `$${cost.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const usageTable = (rows: UsageRow[], totals: UsageTotals): string[] => {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out = [
    line(["Contributor", "Agent", "Sessions", "Total tokens", "Estimated cost"]),
    line(["---", "---", "--:", "--:", "--:"]),
  ];
  for (const row of rows) {
    out.push(
      line([
        row.contributorLabel,
        agentCell(row.agent),
        formatCount(row.sessionsCount),
        humanizeCount(row.totalTokens),
        formatCost(row.costUsd),
      ]),
    );
  }
  out.push(
    line([
      "**Total**",
      "",
      `**${formatCount(totals.sessionsCount)}**`,
      `**${humanizeCount(totals.totalTokens)}**`,
      `**${formatCost(totals.costUsd)}**`,
    ]),
  );
  return out;
};

const tokenDetailTable = (
  rows: UsageRow[],
  totals: UsageTotals,
): string[] => {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out = [
    line(["Contributor", "Input", "Output", "Cache read", "Cache write"]),
    line(["---", "--:", "--:", "--:", "--:"]),
  ];
  for (const row of rows) {
    out.push(
      line([
        row.contributorLabel,
        humanizeCount(row.inputTokens),
        humanizeCount(row.outputTokens),
        humanizeCount(row.cacheReadTokens),
        humanizeCount(row.cacheCreationTokens),
      ]),
    );
  }
  out.push(
    line([
      "**Total**",
      `**${humanizeCount(totals.inputTokens)}**`,
      `**${humanizeCount(totals.outputTokens)}**`,
      `**${humanizeCount(totals.cacheReadTokens)}**`,
      `**${humanizeCount(totals.cacheCreationTokens)}**`,
    ]),
  );
  return out;
};

const modelTable = (breakdown: ModelBreakdownRow[]): string[] => {
  const line = (cells: string[]) => `| ${cells.join(" | ")} |`;
  const out = [
    line(["Model", "Input", "Output", "Cache read", "Cache write", "Total tokens", "Estimated cost"]),
    line(["---", "--:", "--:", "--:", "--:", "--:", "--:"]),
  ];
  for (const row of breakdown) {
    out.push(
      line([
        `\`${row.model}\``,
        humanizeCount(row.inputTokens),
        humanizeCount(row.outputTokens),
        humanizeCount(row.cacheReadTokens),
        humanizeCount(row.cacheCreationTokens),
        humanizeCount(row.totalTokens),
        formatCost(row.costUsd),
      ]),
    );
  }
  return out;
};

export const buildCommentBody = ({
  usage,
  shortSha,
  updatedAtIso,
}: {
  usage: PullRequestUsage;
  shortSha: string;
  updatedAtIso: string;
}): string => {
  const updated = updatedAtIso.replace("T", " ").slice(0, 16);
  const parts = [MARKER, "### Coding agent usage on this pull request", ""];

  if (usage.totals.sessionsCount === 0) {
    parts.push("No coding agent sessions recorded for this pull request.");
  } else {
    parts.push(...usageTable(usage.rows, usage.totals));
    const details: string[] = [];
    details.push("", "<details>", "<summary>Token and model breakdown</summary>", "");
    details.push(...tokenDetailTable(usage.rows, usage.totals));
    if (usage.modelBreakdown.length > 0) {
      details.push("", ...modelTable(usage.modelBreakdown));
      // The contributor totals come from session-level counters; the model
      // rows come from stored per-turn events. A session whose turns were
      // never stored (an outage, a client too old to send them) still counts
      // in the totals, so the model rows can legitimately cover less. Say so
      // rather than leave two tables that appear to contradict each other.
      const modelSum = usage.modelBreakdown.reduce(
        (sum, row) => sum + row.totalTokens,
        0,
      );
      if (modelSum < usage.totals.totalTokens * 0.95) {
        details.push(
          "",
          `> The per-model rows cover ${humanizeCount(modelSum)} of the ` +
            `${humanizeCount(usage.totals.totalTokens)} total tokens. The rest ` +
            "belongs to session turns whose per-call events were not stored, " +
            "so only their session totals are known.",
        );
      }
    }
    details.push("", "</details>");
    parts.push(...details);
  }

  parts.push(
    "",
    "<sub>Tokens as reported by the agents to " +
      "[LangWatch](https://app.langwatch.ai); cost estimated from model list " +
      "prices, over the pull request's whole lifetime. Updated for " +
      `\`${shortSha}\` · ${updated} UTC</sub>`,
  );
  return parts.join("\n");
};

/** The v1 family answers `{"code": "...", "error": "Bad Request", ...}` —
 * the specific code beside a generic status text — while the legacy flat
 * shape carried the code AS the `error` string, and the canonical envelope
 * nests it under `error.code`. Read all three, most specific first, so the
 * script survives either side of the API family migration. */
const errorCodeOf = (body: unknown): string => {
  if (typeof body !== "object" || body === null) return "";
  const record = body as { code?: unknown; error?: unknown };
  if (typeof record.code === "string") return record.code;
  const error = record.error;
  if (typeof error === "string") return error;
  if (typeof error === "object" && error !== null && "code" in error) {
    return String((error as { code: unknown }).code);
  }
  return "";
};

/** The rollup's whole-response shape is the API's; only what the comment
 * renders is typed above, and unknown fields pass through untouched. */
export const interpretUsageResponse = ({
  status,
  body,
}: {
  status: number;
  body: unknown;
}): FetchOutcome => {
  if (status === 200) {
    return { kind: "usage", usage: body as PullRequestUsage };
  }
  const code = errorCodeOf(body);
  if (status === 404 && code === PR_NOT_MAPPED_CODE) {
    return { kind: "none" };
  }
  return {
    kind: "error",
    message: `LangWatch answered ${status}${code ? ` (${code})` : ""}`,
  };
};

const fetchUsage = async ({
  endpoint,
  apiKey,
  repository,
  prNumber,
}: {
  endpoint: string;
  apiKey: string;
  repository: string;
  prNumber: number;
}): Promise<FetchOutcome> => {
  const url =
    `${endpoint}/api/v1/coding-agent/pull-request-usage` +
    `?repository=${encodeURIComponent(repository)}&pullRequest=${prNumber}`;
  let response: Response;
  try {
    response = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (error) {
    return { kind: "error", message: `LangWatch unreachable: ${String(error)}` };
  }
  const body: unknown = await response.json().catch(() => null);
  return interpretUsageResponse({ status: response.status, body });
};

type GithubComment = {
  id: number;
  body?: string;
  user?: { login?: string };
};

const githubHeaders = (token: string) => ({
  Authorization: `Bearer ${token}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
  "Content-Type": "application/json",
});

const findExistingComment = async ({
  apiUrl,
  token,
  repository,
  prNumber,
}: {
  apiUrl: string;
  token: string;
  repository: string;
  prNumber: number;
}): Promise<GithubComment | null> => {
  for (let page = 1; page <= 10; page++) {
    const response = await fetch(
      `${apiUrl}/repos/${repository}/issues/${prNumber}/comments?per_page=100&page=${page}`,
      { headers: githubHeaders(token) },
    );
    if (!response.ok) {
      throw new Error(`Listing comments failed with ${response.status}`);
    }
    const comments = (await response.json()) as GithubComment[];
    const existing = comments.find(
      (comment) =>
        comment.user?.login === "github-actions[bot]" &&
        comment.body?.includes(MARKER),
    );
    if (existing) return existing;
    if (comments.length < 100) return null;
  }
  return null;
};

const upsertComment = async ({
  apiUrl,
  token,
  repository,
  prNumber,
  body,
  existing,
}: {
  apiUrl: string;
  token: string;
  repository: string;
  prNumber: number;
  body: string;
  existing: GithubComment | null;
}): Promise<void> => {
  const target = existing
    ? {
        url: `${apiUrl}/repos/${repository}/issues/comments/${existing.id}`,
        method: "PATCH",
      }
    : {
        url: `${apiUrl}/repos/${repository}/issues/${prNumber}/comments`,
        method: "POST",
      };
  const response = await fetch(target.url, {
    method: target.method,
    headers: githubHeaders(token),
    body: JSON.stringify({ body }),
  });
  if (!response.ok) {
    throw new Error(`${target.method} comment failed with ${response.status}`);
  }
};

const requireEnv = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var ${name}`);
  return value;
};

const run = async (): Promise<void> => {
  const dryRun = process.argv.includes("--dry-run");
  const repository = requireEnv("PR_REPOSITORY");
  const prNumber = Number(requireEnv("PR_NUMBER"));
  const shortSha = requireEnv("PR_HEAD_SHA").slice(0, 7);
  const endpoint = process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai";

  const outcome = await fetchUsage({
    endpoint,
    apiKey: requireEnv("LANGWATCH_API_KEY"),
    repository,
    prNumber,
  });

  // Reporting must never block the pull request: a LangWatch failure is a
  // warning annotation and a green job, and the comment is left as it was.
  if (outcome.kind === "error") {
    console.log(`::warning title=pr-token-usage::${outcome.message}`);
    return;
  }

  const usage: PullRequestUsage =
    outcome.kind === "usage"
      ? outcome.usage
      : { rows: [], totals: emptyTotals(), modelBreakdown: [] };

  const body = buildCommentBody({
    usage,
    shortSha,
    updatedAtIso: new Date().toISOString(),
  });

  if (dryRun) {
    console.log(body);
    return;
  }

  const token = requireEnv("GITHUB_TOKEN");
  const apiUrl = process.env.GITHUB_API_URL ?? "https://api.github.com";
  const existing = await findExistingComment({ apiUrl, token, repository, prNumber });

  // No usage and no comment: stay silent rather than stamp every dependency
  // bump with an empty table. An existing comment is still refreshed, so a
  // rollup that empties never leaves stale numbers behind.
  if (usage.totals.sessionsCount === 0 && !existing) {
    console.log(`No usage recorded for ${repository}#${prNumber}; skipping.`);
    return;
  }

  await upsertComment({ apiUrl, token, repository, prNumber, body, existing });
  console.log(
    `${existing ? "Updated" : "Created"} usage comment on ${repository}#${prNumber}.`,
  );
};

const emptyTotals = (): UsageTotals => ({
  sessionsCount: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  totalTokens: 0,
  costUsd: null,
});

const isMain =
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  run().catch((error) => {
    // Even an unexpected failure only warns: see the non-blocking note above.
    console.log(`::warning title=pr-token-usage::${String(error)}`);
  });
}
