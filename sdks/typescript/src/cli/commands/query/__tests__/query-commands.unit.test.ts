/**
 * The `langwatch query` family, with the API mocked.
 *
 * What these pin is the CONTRACT between the flags and the request: a statement
 * sent as written, parameters bound as given, a keyset walk that rebinds the
 * cursor instead of rewriting the statement, and a refusal before any request
 * for every flag combination that cannot mean anything.
 *
 * @see specs/analytics/lwql-cli-query.feature
 */
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MockInstance } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AGENT_MODE_ENV_VARS } from "../../../utils/output";

const mockQuery = vi.fn();
let stdoutWrite: MockInstance<(chunk: unknown) => boolean>;
const mockSchema = vi.fn();
const mockReference = vi.fn();

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
import { queryExamplesCommand } from "../examples";
import { queryReferenceCommand } from "../reference";
import { runQueryCommand } from "../run";
import { queryLwqlSchemaCommand } from "../schema";

const RESULT = {
  columns: [
    { name: "TraceId", type: "String" },
    { name: "OccurredAt", type: "DateTime64(3)" },
  ],
  rows: [
    { TraceId: "t1", OccurredAt: "2026-09-01 00:00:00.000" },
    { TraceId: "t2", OccurredAt: "2026-09-02 00:00:00.000" },
  ],
  statistics: { elapsedMs: 4, rowsRead: 2, bytesRead: 10, rowsReturned: 2 },
  truncated: false,
  followsTimeWindow: false,
  followsGranularity: false,
  diagnostics: [],
};

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

beforeEach(async () => {
  vi.clearAllMocks();
  savedAgentEnv = Object.fromEntries(
    AGENT_MODE_ENV_VARS.map((name) => [name, process.env[name]]),
  );
  for (const name of AGENT_MODE_ENV_VARS) delete process.env[name];

  mockQuery.mockResolvedValue(RESULT);
  mockSchema.mockResolvedValue({ database: "analytics", datasets: [] });
  mockReference.mockResolvedValue(REFERENCE);
  // A plain function, not an arrow: the command calls `new QueryApiService()`,
  // and an arrow implementation is not constructible.
  vi.mocked(QueryApiService).mockImplementation(function () {
    return {
      query: mockQuery,
      schema: mockSchema,
      reference: mockReference,
    } as unknown as InstanceType<typeof QueryApiService>;
  } as unknown as typeof QueryApiService);

  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  stdoutWrite = vi.spyOn(process.stdout, "write").mockImplementation(
    () => true,
  ) as unknown as MockInstance<(chunk: unknown) => boolean>;
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

describe("runQueryCommand", () => {
  describe("when the statement is the argument", () => {
    /** @scenario "A statement given as an argument is sent as written" */
    it("sends it unchanged", async () => {
      await runQueryCommand("SELECT 1", {});
      expect(mockQuery).toHaveBeenCalledWith({ sql: "SELECT 1" });
    });
  });

  describe("when the statement is a file", () => {
    /** @scenario "A statement can come from a file" */
    it("sends the file's contents unchanged", async () => {
      const dir = mkdtempSync(join(tmpdir(), "lw-query-"));
      const file = join(dir, "q.sql");
      writeFileSync(file, "SELECT 2\n");
      await runQueryCommand(undefined, { sqlFile: file });
      expect(mockQuery).toHaveBeenCalledWith({ sql: "SELECT 2\n" });
    });
  });

  describe("when both a statement and a file are given", () => {
    /** @scenario "A statement and a statement file together are refused" */
    it("refuses before making a request", async () => {
      await expect(
        runQueryCommand("SELECT 1", { sqlFile: "/nowhere.sql" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("when neither a statement nor a file is given", () => {
    it("refuses with an example", async () => {
      await expect(runQueryCommand(undefined, {})).rejects.toThrow(ProcessExitError);
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("when parameters are given", () => {
    /** @scenario "Bound parameters are passed through" */
    it("binds every repetition of the flag", async () => {
      await runQueryCommand("SELECT {a:String}", { param: ["a=1", "b=two"] });
      expect(mockQuery).toHaveBeenCalledWith({
        sql: "SELECT {a:String}",
        parameters: { a: "1", b: "two" },
      });
    });

    /** @scenario "A parameter without a value is refused" */
    it("refuses one with no equals sign", async () => {
      await expect(runQueryCommand("SELECT 1", { param: ["bare"] })).rejects.toThrow(
        ProcessExitError,
      );
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("when a period is given", () => {
    /** @scenario "The period flags fill the statement's reserved window parameters" */
    it("sends it as the time window", async () => {
      await runQueryCommand("SELECT 1", { start: "2026-01-01", end: "2026-01-02" });
      expect(mockQuery).toHaveBeenCalledWith({
        sql: "SELECT 1",
        timeWindow: { start: "2026-01-01", end: "2026-01-02" },
      });
    });

    /** @scenario "A start without an end is refused" */
    it("refuses one end of it", async () => {
      await expect(runQueryCommand("SELECT 1", { start: "2026-01-01" })).rejects.toThrow(
        ProcessExitError,
      );
      expect(mockQuery).not.toHaveBeenCalled();
    });
  });

  describe("when a row limit is given", () => {
    /** @scenario "The row limit is applied to what is printed" */
    it("keeps only that many rows", async () => {
      const result = await runQueryCommand("SELECT 1", { limit: "1" });
      expect((result as { data: { rows: unknown[] } }).data.rows).toHaveLength(
        1,
      );
    });

    it("refuses a limit that is not a whole number", async () => {
      await expect(runQueryCommand("SELECT 1", { limit: "0" })).rejects.toThrow(
        ProcessExitError,
      );
    });
  });

  describe("when the format is the default", () => {
    /** @scenario "The table format prints the result's own columns" */
    it("returns the result for the table renderer to print", async () => {
      const result = await runQueryCommand("SELECT 1", {});
      expect(
        (result as { data: { columns: { name: string }[] } }).data.columns.map(
          (column) => column.name,
        ),
      ).toEqual(["TraceId", "OccurredAt"]);
    });
  });

  describe("when the format is a machine one", () => {
    it("writes the rendered bytes rather than a command result", async () => {
      const result = await runQueryCommand("SELECT 1", { format: "jsonl" });
      expect(result).toBeUndefined();
      const written = stdoutWrite.mock.calls[0]?.[0];
      expect(String(written).trim().split("\n")).toHaveLength(2);
    });

    it("refuses a format it does not have", async () => {
      await expect(runQueryCommand("SELECT 1", { format: "yaml" })).rejects.toThrow(
        ProcessExitError,
      );
    });
  });

  describe("when an output file is given", () => {
    /** @scenario "The output file flag writes the result instead of printing it" */
    it("writes the file and prints nothing to standard output", async () => {
      const dir = mkdtempSync(join(tmpdir(), "lw-query-out-"));
      const file = join(dir, "rows.jsonl");
      await runQueryCommand("SELECT 1", { format: "jsonl", output: file });
      expect(readFileSync(file, "utf-8").trim().split("\n")).toHaveLength(2);
      expect(stdoutWrite).not.toHaveBeenCalled();
    });
  });

  describe("when the caller asks for keyset paging", () => {
    /** @scenario "Keyset paging refuses a statement that does not declare the cursor parameters" */
    it("refuses a statement with no cursor parameters", async () => {
      await expect(
        runQueryCommand("SELECT 1", { pageBy: "keyset", format: "jsonl" }),
      ).rejects.toThrow(ProcessExitError);
      expect(mockQuery).not.toHaveBeenCalled();
    });

    it("refuses a paging mode it does not have", async () => {
      await expect(runQueryCommand("SELECT 1", { pageBy: "offset" })).rejects.toThrow(
        ProcessExitError,
      );
    });

    const KEYSET_SQL =
      "SELECT TraceId, OccurredAt FROM analytics.traces WHERE (OccurredAt, TraceId) > ({after_ts:DateTime64(3)}, {after_id:String}) ORDER BY OccurredAt, TraceId LIMIT 2";

    /** @scenario "Keyset paging rebinds the cursor parameters between pages" */
    it("rebinds the cursor to the last row of the page before it", async () => {
      mockQuery
        .mockResolvedValueOnce(RESULT)
        .mockResolvedValueOnce({ ...RESULT, rows: [RESULT.rows[0]] })
        .mockResolvedValue({ ...RESULT, rows: [] });

      await runQueryCommand(KEYSET_SQL, { pageBy: "keyset", format: "jsonl" });

      expect(mockQuery.mock.calls[0]?.[0].parameters).toEqual({
        after_ts: "1970-01-01 00:00:00.000",
        after_id: "",
      });
      expect(mockQuery.mock.calls[1]?.[0].parameters).toEqual({
        after_ts: "2026-09-02 00:00:00.000",
        after_id: "t2",
      });
    });

    it("sends the identical statement on every page", async () => {
      mockQuery
        .mockResolvedValueOnce(RESULT)
        .mockResolvedValueOnce({ ...RESULT, rows: [RESULT.rows[0]] })
        .mockResolvedValue({ ...RESULT, rows: [] });

      await runQueryCommand(KEYSET_SQL, { pageBy: "keyset", format: "jsonl" });

      const statements = new Set(
        mockQuery.mock.calls.map((call) => call[0].sql as string),
      );
      expect([...statements]).toEqual([KEYSET_SQL]);
    });

    /** @scenario "Keyset paging stops when a page comes back short" */
    it("stops after a page shorter than the one before it", async () => {
      mockQuery
        .mockResolvedValueOnce(RESULT)
        .mockResolvedValueOnce({ ...RESULT, rows: [RESULT.rows[0]] });

      await runQueryCommand(KEYSET_SQL, { pageBy: "keyset", format: "jsonl" });

      expect(mockQuery).toHaveBeenCalledTimes(2);
    });
  });
});

describe("queryLwqlSchemaCommand", () => {
  /** @scenario "The schema subcommand prints the datasets and their columns" */
  it("returns the datasets the endpoint publishes", async () => {
    mockSchema.mockResolvedValue({
      database: "analytics",
      datasets: [
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
    expect(
      (result as { data: { datasets: { name: string }[] } }).data.datasets[0]
        ?.name,
    ).toBe("analytics.traces");
  });
});

describe("queryReferenceCommand", () => {
  /** @scenario "The reference subcommand prints the whole reference" */
  it("returns the whole document by default", async () => {
    const result = await queryReferenceCommand({});
    expect((result as { data: typeof REFERENCE }).data.version).toBe("1");
    expect((result as { data: typeof REFERENCE }).data.decisionTable).toHaveLength(
      1,
    );
  });

  /** @scenario "The reference subcommand can print one section" */
  it("returns only the section the caller named", async () => {
    const result = await queryReferenceCommand({ section: "trace-filter" });
    expect(
      (result as { data: { fields: { name: string }[] } }).data.fields[0]?.name,
    ).toBe("status");
  });

  it("refuses a section it does not have", async () => {
    await expect(queryReferenceCommand({ section: "sql" })).rejects.toThrow(
      ProcessExitError,
    );
    expect(mockReference).not.toHaveBeenCalled();
  });
});

describe("queryExamplesCommand", () => {
  /** @scenario "The examples subcommand prints the example library" */
  it("returns every example with its identifier and statement", async () => {
    const result = await queryExamplesCommand({});
    const examples = (result as { data: { examples: { id: string }[] } }).data
      .examples;
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
    await expect(queryExamplesCommand({ language: "sql" })).rejects.toThrow(
      ProcessExitError,
    );
  });
});
