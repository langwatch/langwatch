import { env } from "../env.mjs";
import type { Trace } from "../server/tracer/types";
import { esClient } from "../server/elasticsearch";
import { TRACE_INDEX } from "../server/api/routers/traces";
import { getDebugger } from "../utils/logger";

const debug = getDebugger("langwatch:categorization");

export const categorizeProject = async (projectId: string): Promise<void> => {
  // Fetch last 5k traces for the project in last 3 months, with only id, input fields and their categories
  const result = await esClient.search<Trace>({
    index: TRACE_INDEX,
    body: {
      query: {
        //@ts-ignore
        bool: {
          must: [
            {
              term: { project_id: projectId },
            },
            {
              range: {
                "timestamps.inserted_at": {
                  gte: "now-3M/M",
                  lt: "now/M",
                },
              },
            },
          ],
        },
      },
      _source: ["id", "input", "categories"],
      size: 5000,
    },
  });

  const traces = result.hits.hits
    .map((hit) => hit._source!)
    .filter((hit) => hit);

  if (traces.length === 0) {
    debug("No traces found for project", projectId, "skipping categorization");
    return;
  }

  debug("Categorizing", traces.length, "traces for project", projectId);
  const categories = await categorizeTraces({
    categories: traces.flatMap((trace) => trace.categories ?? []),
    file: traces.map((trace) => ({
      _source: {
        id: trace.id,
        input: trace.input,
      },
    })),
  });

  debug(
    "Found categories for",
    Object.keys(categories).length,
    "traces for project",
    projectId,
    ", updating ES"
  );
  const body = Object.entries(categories).flatMap(([traceId, category]) => [
    { update: { _id: traceId } },
    { doc: { categories: category } },
  ]);

  await esClient.bulk({
    index: TRACE_INDEX,
    refresh: true,
    body,
  });
};

export type CategorizationParams = {
  categories: string[];
  file: { _source: { id: string; input: Trace["input"] } }[];
};

export const categorizeTraces = async (
  params: CategorizationParams
): Promise<Record<string, string>> => {
  if (!env.CATEGORIZATION_SERVICE_URL) {
    console.warn("Categorization service URL not set, skipping categorization");
    return {};
  }

  const formData = new FormData();
  formData.append("categories", params.categories.join(",") || " ");

  const file = new File(
    [params.file.map((line) => JSON.stringify(line)).join("\n")],
    "traces.jsonl",
    { type: "application/jsonl" }
  );
  formData.append("file", file);

  const response = await fetch(env.CATEGORIZATION_SERVICE_URL, {
    method: "POST",
    body: formData,
  });
  const topics: Record<string, string> = await response.json();

  return topics;
};
