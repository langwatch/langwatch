/**
 * The `langwatch query` discovery subcommands with the API mocked. `schema`, `reference` and
 * `examples` slice one document, so the tests pin the slicing.
 * @see specs/analytics/lwql-cli-query.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const mockSchema = vi.fn();
const mockReference = vi.fn();

vi.mock("@/client-sdk/services/query/query-api.service", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, QueryApiService: vi.fn() };
});

vi.mock("../../../utils/apiKey", () => ({
  resolveCredentials: vi.fn(async () => ({
    apiKey: "test-key",
    source: "env",
    endpoint: "https://app.langwatch.ai",
    projectId: "project-1",
  })),
}));

vi.mock("ora", () => ({
  default: () => ({
    start: vi.fn().mockReturnThis(),
    succeed: vi.fn(),
    fail: vi.fn(),
  }),
}));

class ProcessExitError extends Error {
  constructor(public code: number) {
    super(`process.exit(${code})`);
  }
}

import { QueryApiService } from "@/client-sdk/services/query/query-api.service";

import { queryExamplesCommand } from "../examples";
import { queryReferenceCommand } from "../reference";
import { queryLwqlSchemaCommand } from "../schema";

const REFERENCE = {
  version: "1",
  lwql: {
    enabled: true,
    schema: { database: "analytics", views: [] },
    limits: {
      maxStatementLength: 1,
      maxRowsReturned: 2,
      maxResultBytes: 3,
      maxExecutionTimeSeconds: 4,
      pagination: "keyset",
    },
    endpoints: [],
  },
  traceFilter: {
    syntax: "# Trace query syntax\ntrace.attribute.<key>",
    fields: [
      {
        name: "status",
        label: "Status",
        valueType: "categorical",
        group: "trace",
        facetable: true,
        knownValues: ["error", "ok"],
      },
    ],
    dynamicPrefixes: [
      {
        prefix: "trace.attribute.",
        label: "Trace attribute",
        description: "a key on the trace",
        aliases: ["attribute."],
      },
    ],
    endpoints: [],
  },
  examples: [
    {
      id: "lwql.cost-by-model",
      title: "Spend by model",
      intent: "cost",
      language: "lwql",
      tags: ["cost", "models"],
      text: "SELECT Model FROM analytics.model_usage_by_minute",
      parameters: [],
      requires: { gates: ["costs"], functions: [] },
      available: true,
    },
    {
      id: "filter.failures",
      title: "Traces that failed",
      intent: "triage",
      language: "trace-filter",
      tags: ["errors"],
      text: "status:error",
      parameters: [],
      requires: { gates: [], functions: [] },
      available: true,
    },
  ],
  decisionTable: [{ when: "counts", use: "LangWatchQL", why: "one aggregate" }],
};

let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  savedAgentEnv = Object.fromEntries(AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]));
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];

  mockSchema.mockResolvedValue({ database: "analytics", views: [] });
  mockReference.mockResolvedValue(REFERENCE);
  // A plain function, not an arrow: the command calls `new QueryApiService()`,
  // and an arrow implementation is not constructible.
  vi.mocked(QueryApiService).mockImplementation(function () {
    return {
      schema: mockSchema,
      reference: mockReference,
    } as unknown as InstanceType<typeof QueryApiService>;
  } as unknown as typeof QueryApiService);

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(process, "exit").mockImplementation((code) => {
    throw new ProcessExitError(code as number);
  });
});

afterEach(() => {
  for (const [name, value] of Object.entries(savedAgentEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  vi.restoreAllMocks();
});

describe("queryLwqlSchemaCommand", () => {
  /** @scenario "The schema subcommand prints the views and their columns" */
  it("returns the views the endpoint publishes", async () => {
    mockSchema.mockResolvedValue({
      database: "analytics",
      views: [
        {
          name: "analytics.traces",
          description: "one row per trace",
          grain: "trace",
          joinKeys: [],
          timeColumn: "OccurredAt",
          freshness: "seconds",
          columns: [
            {
              name: "TraceId",
              type: "String",
              description: "id",
              unit: null,
              gates: [],
              available: true,
            },
          ],
          exampleSql: "SELECT 1",
        },
      ],
    });
    const result = await queryLwqlSchemaCommand({});
    expect((result as { data: { views: { name: string }[] } }).data.views[0]?.name).toBe(
      "analytics.traces",
    );
  });
});

describe("queryReferenceCommand", () => {
  /** @scenario "The reference subcommand prints the whole reference" */
  it("returns the whole document by default", async () => {
    const result = await queryReferenceCommand({});
    expect((result as { data: typeof REFERENCE }).data.version).toBe("1");
    expect((result as { data: typeof REFERENCE }).data.decisionTable).toHaveLength(1);
  });

  /** @scenario "The reference subcommand can print one section" */
  it("returns only the section the caller named", async () => {
    const result = await queryReferenceCommand({ section: "trace-filter" });
    expect((result as { data: { fields: { name: string }[] } }).data.fields[0]?.name).toBe(
      "status",
    );
  });

  it("refuses a section it does not have", async () => {
    await expect(queryReferenceCommand({ section: "sql" })).rejects.toThrow(ProcessExitError);
    expect(mockReference).not.toHaveBeenCalled();
  });
});

describe("queryExamplesCommand", () => {
  /** @scenario "The examples subcommand prints the example library" */
  it("returns every example with its identifier and statement", async () => {
    const result = await queryExamplesCommand({});
    const examples = (result as { data: { examples: { id: string }[] } }).data.examples;
    expect(examples.map((example) => example.id)).toEqual([
      "lwql.cost-by-model",
      "filter.failures",
    ]);
  });

  /** @scenario "The examples subcommand filters by tag and by language" */
  it("keeps only the examples carrying the tag in the language", async () => {
    const result = await queryExamplesCommand({
      tag: "cost",
      language: "lwql",
    });
    expect(
      (result as { data: { examples: { id: string }[] } }).data.examples.map(
        (example) => example.id,
      ),
    ).toEqual(["lwql.cost-by-model"]);
  });

  it("matches an intent as well as a tag, since every example has one", async () => {
    const result = await queryExamplesCommand({ tag: "triage" });
    expect(
      (result as { data: { examples: { id: string }[] } }).data.examples.map(
        (example) => example.id,
      ),
    ).toEqual(["filter.failures"]);
  });

  it("refuses a language it does not have", async () => {
    await expect(queryExamplesCommand({ language: "sql" })).rejects.toThrow(ProcessExitError);
  });
});
