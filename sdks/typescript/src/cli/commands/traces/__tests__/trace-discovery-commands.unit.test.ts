/**
 * `langwatch trace facets` and `langwatch trace fields`, with the API mocked.
 *
 * The pair is the discovery loop: fields says what exists, facets says what is
 * in it. What matters here is that each sends what the flags asked for and
 * renders the shape the endpoint answered with — the facets door answers two
 * different shapes from one path, and telling them apart by the wrong key is
 * how a caller ends up with an empty table over a full payload.
 *
 * @see specs/traces/trace-filter-api.feature
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const mockFacets = vi.fn();
const mockSearch = vi.fn();
const mockReference = vi.fn();

vi.mock("@/client-sdk/services/traces/traces-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>;
  return { ...actual, TracesApiService: vi.fn() };
});

vi.mock("@/client-sdk/services/query/query-api.service", async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
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
import { TracesApiService } from "@/client-sdk/services/traces/traces-api.service";
import { traceFacetsCommand } from "../facets";
import { traceFieldsCommand } from "../fields";

const REFERENCE = {
  version: "1",
  lwql: {
    enabled: true,
    schema: { database: "analytics", datasets: [] },
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
    syntax: "# Trace query syntax\n\nwrite trace.attribute.<key>",
    fields: [
      {
        name: "status",
        label: "Status",
        valueType: "categorical",
        group: "trace",
        facetable: true,
        knownValues: ["error", "ok"],
      },
      {
        name: "traceId",
        label: "Trace ID",
        valueType: "text",
        group: "trace",
        facetable: false,
        knownValues: [],
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
    {
      id: "lwql.recent-failures",
      title: "Recent failures",
      intent: "triage",
      language: "lwql",
      tags: ["errors"],
      text: "SELECT 1",
      parameters: [],
      requires: { gates: [], functions: [] },
      available: true,
    },
  ],
  decisionTable: [],
};

let savedAgentEnv: Record<string, string | undefined> = {};

beforeEach(async () => {
  vi.clearAllMocks();
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];

  mockReference.mockResolvedValue(REFERENCE);
  vi.mocked(TracesApiService).mockImplementation(function () {
    return { facets: mockFacets, search: mockSearch } as unknown as InstanceType<
      typeof TracesApiService
    >;
  } as unknown as typeof TracesApiService);
  vi.mocked(QueryApiService).mockImplementation(function () {
    return { reference: mockReference } as unknown as InstanceType<
      typeof QueryApiService
    >;
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

describe("traceFacetsCommand", () => {
  describe("when a field is given", () => {
    /** @scenario "The CLI prints a field's values" */
    it("returns the values with their counts", async () => {
      mockFacets.mockResolvedValue({
        values: [{ value: "gpt-5-mini", count: 7 }],
        total: 1,
        hasMore: false,
      });
      const result = await traceFacetsCommand("model", {});
      expect(
        (result as { data: { values: { value: string; count: number }[] } }).data
          .values,
      ).toEqual([{ value: "gpt-5-mini", count: 7 }]);
    });

    it("sends the field, prefix and limit as given", async () => {
      mockFacets.mockResolvedValue({ values: [], total: 0, hasMore: false });
      await traceFacetsCommand("model", { prefix: "gpt", limit: "5" });
      expect(mockFacets).toHaveBeenCalledWith({
        field: "model",
        prefix: "gpt",
        limit: 5,
      });
    });

    it("refuses a limit that is not a whole number", async () => {
      await expect(
        traceFacetsCommand("model", { limit: "many" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockFacets).not.toHaveBeenCalled();
    });
  });

  describe("when no field is given", () => {
    it("returns the whole discovery payload", async () => {
      mockFacets.mockResolvedValue({
        facets: [
          {
            key: "model",
            kind: "categorical",
            label: "Model",
            group: "span",
            topValues: [{ value: "gpt-5", count: 3 }],
          },
        ],
        pending: false,
      });
      const result = await traceFacetsCommand(undefined, {});
      expect(
        (result as { data: { facets: { key: string }[] } }).data.facets[0]?.key,
      ).toBe("model");
      expect(mockFacets).toHaveBeenCalledWith({});
    });
  });
});

describe("traceFieldsCommand", () => {
  /** @scenario "The CLI prints the filter fields and the syntax" */
  it("returns every field with its label, value type and group", async () => {
    const result = await traceFieldsCommand({});
    const fields = (
      result as {
        data: { fields: { name: string; valueType: string; group: string }[] };
      }
    ).data.fields;
    expect(fields.map((field) => field.name)).toEqual(["status", "traceId"]);
    expect(fields[0]?.valueType).toBe("categorical");
    expect(fields[0]?.group).toBe("trace");
  });

  /** @scenario "The CLI prints the filter fields and the syntax" */
  it("returns the syntax document when asked for it", async () => {
    const result = await traceFieldsCommand({ syntax: true });
    expect((result as { data: { syntax: string } }).data.syntax).toContain(
      "trace.attribute.",
    );
  });

  /** @scenario "The CLI prints the filter fields and the syntax" */
  it("returns only the filter examples when asked for them", async () => {
    const result = await traceFieldsCommand({ examples: true });
    expect(
      (result as { data: { examples: { id: string }[] } }).data.examples.map(
        (example) => example.id,
      ),
    ).toEqual(["filter.failures"]);
  });
});
