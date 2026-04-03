import {
  listDatasets as apiListDatasets,
  type DatasetSummary,
} from "../langwatch-api-datasets.js";
import { escapeMarkdown } from "../utils/escape-markdown.js";

/**
 * Fetches all datasets by paginating through the API until every page
 * has been retrieved.
 *
 * Returns the accumulated dataset summaries along with the total count
 * reported by the server.
 */
async function fetchAllDatasets(): Promise<{
  datasets: DatasetSummary[];
  total: number;
}> {
  const PAGE_SIZE = 100;
  const datasets: DatasetSummary[] = [];
  let page = 1;
  let total = 0;

  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- loop until break
  while (true) {
    const response = await apiListDatasets({ page, limit: PAGE_SIZE });
    total = response.total;
    datasets.push(...response.data);

    if (datasets.length >= total || response.data.length === 0) {
      break;
    }
    page++;
  }

  return { datasets, total };
}

/**
 * Handles the platform_list_datasets MCP tool invocation.
 *
 * Lists all datasets in the LangWatch project, formatted as an
 * AI-readable digest or raw JSON.
 */
export async function handleListDatasets(params: {
  format?: "digest" | "json";
} = {}): Promise<string> {
  if (params.format === "json") {
    const { datasets, total } = await fetchAllDatasets();
    return JSON.stringify({ data: datasets, total }, null, 2);
  }

  const { datasets, total } = await fetchAllDatasets();

  if (datasets.length === 0) {
    return "No datasets found in this project.\n\n> Tip: Use `platform_create_dataset` to create your first dataset.";
  }

  const lines: string[] = [];
  lines.push(`# Datasets (${total} total)\n`);

  for (const ds of datasets) {
    lines.push(`## ${escapeMarkdown(ds.name)}`);
    lines.push(`**Slug**: ${escapeMarkdown(ds.slug)}`);
    lines.push(`**ID**: ${ds.id}`);
    if (Array.isArray(ds.columnTypes) && ds.columnTypes.length > 0) {
      const colNames = ds.columnTypes.map((c) => c.name).join(", ");
      lines.push(`**Columns**: ${colNames}`);
    }
    lines.push(
      `**Records**: ${ds.recordCount ?? "unknown"}`,
    );
    lines.push("");
  }

  lines.push(
    "> Use `platform_get_dataset` with the slug to see full dataset details and records.",
  );

  return lines.join("\n");
}
