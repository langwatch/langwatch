import { listDatasets as apiListDatasets } from "../langwatch-api-datasets.js";

/**
 * Handles the platform_list_datasets MCP tool invocation.
 *
 * Lists all datasets in the LangWatch project, formatted as an
 * AI-readable markdown summary.
 */
export async function handleListDatasets(): Promise<string> {
  const response = await apiListDatasets();
  const datasets = response.data;

  if (!Array.isArray(datasets) || datasets.length === 0) {
    return "No datasets found in this project.\n\n> Tip: Use `platform_create_dataset` to create your first dataset.";
  }

  const lines: string[] = [];
  lines.push(`# Datasets (${datasets.length} total)\n`);

  for (const ds of datasets) {
    lines.push(`## ${ds.name}`);
    lines.push(`**Slug**: ${ds.slug}`);
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
