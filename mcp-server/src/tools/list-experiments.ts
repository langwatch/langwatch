import { makeRequest } from "../langwatch-api.js";

interface ExperimentSummary {
  id: string;
  slug: string;
  name: string | null;
  type: string;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
  runsCount: number;
  lastRunAt: string | null;
}

interface ExperimentListResponse {
  experiments: ExperimentSummary[];
  pagination: {
    page: number;
    pageSize: number;
    totalHits: number;
    hasMore: boolean;
  };
}

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100;

const formatTimestamp = (iso: string | null): string => {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().replace("T", " ").slice(0, 19) + " UTC";
};

const escapeMarkdownTableCell = (value: string): string =>
  value.replace(/[\\|]/g, (c) => `\\${c}`).replace(/\n/g, " ");

const formatInlineCode = (value: string): string =>
  `\`${value.replace(/[\\`|]/g, (c) => `\\${c}`).replace(/\n/g, " ")}\``;

export async function handleExperimentList(params: {
  limit?: number;
}): Promise<string> {
  const requested =
    typeof params.limit === "number" && params.limit > 0
      ? params.limit
      : DEFAULT_LIMIT;
  const effectiveLimit = Math.min(requested, MAX_LIMIT);

  const search = new URLSearchParams();
  search.set("pageSize", String(effectiveLimit));

  const result = (await makeRequest(
    "GET",
    `/api/experiments?${search.toString()}`,
  )) as ExperimentListResponse;

  if (result.experiments.length === 0) {
    return [
      "# Experiments",
      "",
      "_No experiments found in this project._",
      "",
      "> Create an experiment in the LangWatch dashboard, then re-run this tool to discover its slug.",
    ].join("\n");
  }

  const lines: string[] = [];
  lines.push("# Experiments");
  lines.push("");
  lines.push(
    `Showing ${result.experiments.length} of ${result.pagination.totalHits} experiment${result.pagination.totalHits === 1 ? "" : "s"}.`,
  );
  if (result.pagination.hasMore) {
    lines.push(
      `> More experiments exist beyond this limit. Re-run with a higher \`limit\` (max ${MAX_LIMIT}) if needed.`,
    );
  }
  lines.push("");
  lines.push("| Slug | Name | Runs | Last Run |");
  lines.push("|------|------|------|----------|");

  for (const exp of result.experiments) {
    const name = escapeMarkdownTableCell(exp.name ?? exp.slug);
    lines.push(
      `| ${formatInlineCode(exp.slug)} | ${name} | ${exp.runsCount} | ${formatTimestamp(exp.lastRunAt)} |`,
    );
  }

  lines.push("");
  lines.push(
    "> Use `platform_experiment_list_runs` with one of these slugs to see its runs.",
  );
  return lines.join("\n");
}
