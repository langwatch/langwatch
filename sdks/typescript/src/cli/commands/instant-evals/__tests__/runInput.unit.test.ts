/**
 * The body one command line becomes.
 *
 * Every flag combination that has a meaning, and every one that does not:
 * a line that says two things at once is refused BEFORE anything is sent, so
 * these assert on the body or on the exit rather than on any request.
 *
 * @see specs/features/instant-eval-cli.feature
 */

import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildInstantEvalRunBody } from "../runInput";
import type { QuestionDraft } from "../questionFlags";

class ProcessExitError extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

const NOW = Date.parse("2026-09-18T12:00:00.000Z");

let exitSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn>;
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new ProcessExitError(code ?? 0);
  }) as never);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
  logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  exitSpy.mockRestore();
  errorSpy.mockRestore();
  logSpy.mockRestore();
});

const ask = (instructions: string, extra: Partial<QuestionDraft> = {}): QuestionDraft => ({
  instructions,
  criteria: [],
  categories: [],
  ...extra,
});

const build = (args: {
  instructions?: string;
  drafts?: QuestionDraft[];
  flags?: Record<string, unknown>;
}) =>
  buildInstantEvalRunBody({
    ...(args.instructions === undefined ? {} : { instructions: args.instructions }),
    drafts: args.drafts ?? [],
    flags: (args.flags ?? {}) as never,
    now: NOW,
  });

/** What the refusal said, for a line that was refused. */
const refusalOf = async (promise: Promise<unknown>): Promise<string> => {
  await expect(promise).rejects.toThrow(ProcessExitError);
  return errorSpy.mock.calls
    .map((call: unknown[]) => String(call[0]))
    .join("\n");
};

describe("readLast, given a window far past any date", () => {
  describe("when the digits overflow", () => {
    /** @scenario "A --last window past any date is refused" */
    it("refuses a run of digits that overflows to infinity", async () => {
      const refusal = await refusalOf(
        build({ instructions: "annoyed", flags: { last: `${"9".repeat(400)}w` } }),
      );

      expect(refusal).toContain("--last");
    });

    /** @scenario "A --last window past any date is refused" */
    it("refuses a finite window no instant can sit in", async () => {
      const refusal = await refusalOf(
        build({ instructions: "annoyed", flags: { last: "99999999999999999999w" } }),
      );

      expect(refusal).toContain("--last");
    });
  });
});

describe("buildInstantEvalRunBody, given the shorthand", () => {
  describe("when the question is the positional argument", () => {
    /** @scenario "A question given as the positional argument starts a run" */
    it("asks it as a yes or no question of traces", async () => {
      const body = await build({ instructions: "the customer sounds annoyed" });

      expect(body).toMatchObject({
        target: "traces",
        limit: 1_000,
        questions: [
          { kind: "boolean", instructions: "the customer sounds annoyed" },
        ],
      });
    });
  });

  describe("when the question is given with --ask", () => {
    /** @scenario "The positional argument and --ask are the same thing" */
    it("asks the same question", async () => {
      const body = await build({ drafts: [ask("the customer sounds annoyed")] });

      expect(body).toMatchObject({
        questions: [
          { kind: "boolean", instructions: "the customer sounds annoyed" },
        ],
      });
    });

    it("refuses the positional argument alongside it", async () => {
      const said = await refusalOf(
        build({ instructions: "one", drafts: [ask("two")] }),
      );

      expect(said).toContain("not both");
    });
  });

  describe("when --ask is repeated", () => {
    /** @scenario "Repeating --ask asks several questions of the same text" */
    it("asks both questions of the same text", async () => {
      const body = await build({
        drafts: [ask("the customer is annoyed"), ask("the agent apologised")],
      });

      expect((body as { questions: unknown[] }).questions).toHaveLength(2);
    });
  });

  describe("when a boolean question carries criteria", () => {
    /** @scenario "--criteria spells out the boundary of a boolean question" */
    it("keeps both in the order they were written", async () => {
      const body = await build({
        drafts: [
          ask("annoyed", {
            criteria: ["sarcasm counts", "a calm complaint does not"],
          }),
        ],
      });

      expect(body).toMatchObject({
        questions: [
          {
            kind: "boolean",
            criteria: ["sarcasm counts", "a calm complaint does not"],
          },
        ],
      });
    });
  });

  describe("when a question carries --threshold", () => {
    it("reads it as a probability", async () => {
      const body = await build({ drafts: [ask("annoyed", { threshold: "0.7" })] });

      expect(body).toMatchObject({
        questions: [{ kind: "boolean", threshold: 0.7 }],
      });
    });

    it("refuses one outside nought to one", async () => {
      const said = await refusalOf(
        build({ drafts: [ask("annoyed", { threshold: "7" })] }),
      );

      expect(said).toContain("--threshold");
    });
  });

  describe("when a question carries --score", () => {
    /** @scenario "--score asks for a rating instead of a yes or no" */
    it("reads the range from min..max", async () => {
      const body = await build({
        drafts: [ask("how satisfied", { score: "1..5" })],
      });

      expect(body).toMatchObject({
        questions: [{ kind: "score", range: { min: 1, max: 5 } }],
      });
    });

    /** @scenario "A malformed --score range is refused before anything is sent" */
    it("refuses a value that is not a range", async () => {
      const said = await refusalOf(
        build({ drafts: [ask("how satisfied", { score: "5" })] }),
      );

      expect(said).toContain("min..max");
    });
  });

  describe("when a question carries --category", () => {
    /** @scenario "--category asks which option fits" */
    it("reads each option as a name and what it means", async () => {
      const body = await build({
        drafts: [
          ask("what is being asked for", {
            categories: [
              "refund=wants money back",
              "bug=something is broken",
            ],
          }),
        ],
      });

      expect(body).toMatchObject({
        questions: [
          {
            kind: "category",
            options: [
              { name: "refund", description: "wants money back" },
              { name: "bug", description: "something is broken" },
            ],
          },
        ],
      });
    });

    it("refuses an option written without a name", async () => {
      const said = await refusalOf(
        build({ drafts: [ask("what", { categories: ["=nothing"] })] }),
      );

      expect(said).toContain("--category");
    });
  });

  describe("when the questions come from a file", () => {
    const write = (name: string, contents: string): string => {
      const directory = mkdtempSync(join(tmpdir(), "instant-eval-"));
      const path = join(directory, name);
      writeFileSync(path, contents, "utf-8");
      return path;
    };

    /** @scenario "--questions-file reads a list of questions with their own ids" */
    it("reads a JSON list, ids and all", async () => {
      const path = write(
        "questions.json",
        JSON.stringify([
          { id: "annoyed", kind: "boolean", instructions: "annoyed?" },
          {
            id: "satisfaction",
            kind: "score",
            instructions: "how satisfied",
            range: { min: 1, max: 5 },
          },
        ]),
      );

      const body = await build({ flags: { questionsFile: path } });

      expect(body).toMatchObject({
        questions: [{ id: "annoyed" }, { id: "satisfaction" }],
      });
    });

    it("reads a YAML file the same way", async () => {
      const path = write(
        "questions.yaml",
        "- id: annoyed\n  kind: boolean\n  instructions: annoyed?\n",
      );

      const body = await build({ flags: { questionsFile: path } });

      expect(body).toMatchObject({ questions: [{ id: "annoyed" }] });
    });

    it("reads an object carrying a questions list", async () => {
      const path = write(
        "questions.json",
        JSON.stringify({
          questions: [{ kind: "boolean", instructions: "annoyed?" }],
        }),
      );

      const body = await build({ flags: { questionsFile: path } });

      expect((body as { questions: unknown[] }).questions).toHaveLength(1);
    });

    it("refuses the flags alongside the file", async () => {
      const path = write(
        "questions.json",
        JSON.stringify([{ kind: "boolean", instructions: "annoyed?" }]),
      );

      const said = await refusalOf(
        build({ drafts: [ask("annoyed")], flags: { questionsFile: path } }),
      );

      expect(said).toContain("--questions-file");
    });

    it("refuses a file it cannot read", async () => {
      const said = await refusalOf(
        build({ flags: { questionsFile: "/no/such/questions.json" } }),
      );

      expect(said).toContain("Could not read");
    });
  });

  describe("when nothing was asked at all", () => {
    /** @scenario "A run with no question at all is refused" */
    it("refuses and names every way to ask", async () => {
      const said = await refusalOf(build({ flags: { target: "traces" } }));

      expect(said).toContain("--ask");
      expect(said).toContain("--questions-file");
      expect(said).toContain("--sql");
    });
  });

  describe("when --target names what a row is", () => {
    /** @scenario "--target picks what a row is" */
    it("sends the wire spelling of llm spans", async () => {
      const body = await build({
        instructions: "annoyed",
        flags: { target: "llm-spans" },
      });

      expect(body).toMatchObject({ target: "llm_spans" });
    });

    it("refuses a target that is not one of the three", async () => {
      const said = await refusalOf(
        build({ instructions: "annoyed", flags: { target: "sessions" } }),
      );

      expect(said).toContain("--target");
    });
  });

  describe("when the window is named", () => {
    /** @scenario "--last sets the window and --start with --end sets it exactly" */
    it("turns --last into two instants", async () => {
      const body = await build({
        instructions: "annoyed",
        flags: { last: "7d" },
      });

      expect(body).toMatchObject({
        start: "2026-09-11T12:00:00.000Z",
        end: "2026-09-18T12:00:00.000Z",
      });
    });

    it("reads --start and --end as they were written", async () => {
      const body = await build({
        instructions: "annoyed",
        flags: { start: "2026-09-01T00:00:00Z", end: "2026-09-02T00:00:00Z" },
      });

      expect(body).toMatchObject({
        start: "2026-09-01T00:00:00.000Z",
        end: "2026-09-02T00:00:00.000Z",
      });
    });

    it("refuses --last alongside --start", async () => {
      const said = await refusalOf(
        build({
          instructions: "annoyed",
          flags: { last: "7d", start: "2026-09-01T00:00:00Z" },
        }),
      );

      expect(said).toContain("--last");
    });

    it("refuses a window that is neither a timestamp nor epoch milliseconds", async () => {
      const said = await refusalOf(
        build({ instructions: "annoyed", flags: { start: "last tuesday" } }),
      );

      expect(said).toContain("--start");
    });

    it("refuses a --last value with no unit", async () => {
      const said = await refusalOf(
        build({ instructions: "annoyed", flags: { last: "7" } }),
      );

      expect(said).toContain("--last");
    });
  });

  describe("when a filter is given", () => {
    /** @scenario "--filter is passed through to the shorthand" */
    it("passes it through unchanged", async () => {
      const body = await build({
        instructions: "annoyed",
        flags: { filter: "service:checkout AND cost:>0.01" },
      });

      expect(body).toMatchObject({
        filter: "service:checkout AND cost:>0.01",
      });
    });
  });

  describe("when --limit is given", () => {
    it("sends it", async () => {
      const body = await build({
        instructions: "annoyed",
        flags: { limit: "10000" },
      });

      expect(body).toMatchObject({ limit: 10_000 });
    });

    it("refuses one that is not a positive whole number", async () => {
      const said = await refusalOf(
        build({ instructions: "annoyed", flags: { limit: "-5" } }),
      );

      expect(said).toContain("--limit");
    });
  });

  describe("when --param is given alongside a target", () => {
    it("refuses, because the expansion writes the parameters", async () => {
      const said = await refusalOf(
        build({ instructions: "annoyed", flags: { param: ["since=x"] } }),
      );

      expect(said).toContain("--param");
    });
  });
});

describe("buildInstantEvalRunBody, given a statement", () => {
  const SQL = "SELECT TraceId, eval(x, 'y') AS q1 FROM traces";

  describe("when --sql carries it", () => {
    /** @scenario "--sql starts a run from a statement" */
    it("sends it as written, with no target", async () => {
      const body = await build({ flags: { sql: SQL } });

      expect(body).toMatchObject({ sql: SQL, limit: 1_000 });
      expect(body).not.toHaveProperty("target");
    });
  });

  describe("when --sql-file carries it", () => {
    /** @scenario "--sql-file reads the statement from a file" */
    it("sends the file's contents", async () => {
      const directory = mkdtempSync(join(tmpdir(), "instant-eval-"));
      const path = join(directory, "query.sql");
      writeFileSync(path, SQL, "utf-8");

      const body = await build({ flags: { sqlFile: path } });

      expect(body).toMatchObject({ sql: SQL });
    });

    it("refuses a file it cannot read", async () => {
      const said = await refusalOf(
        build({ flags: { sqlFile: "/no/such/query.sql" } }),
      );

      expect(said).toContain("Could not read");
    });

    it("refuses --sql alongside it", async () => {
      const said = await refusalOf(
        build({ flags: { sql: SQL, sqlFile: "/tmp/query.sql" } }),
      );

      expect(said).toContain("--sql-file");
    });
  });

  describe("when the line also describes a shorthand", () => {
    /** @scenario "A statement and a shorthand flag together are refused by the command" */
    it("refuses a target", async () => {
      const said = await refusalOf(
        build({ flags: { sql: SQL, target: "traces" } }),
      );

      expect(said).toContain("not both");
    });

    it("refuses a question", async () => {
      const said = await refusalOf(
        build({ drafts: [ask("annoyed")], flags: { sql: SQL } }),
      );

      expect(said).toContain("not both");
    });
  });

  describe("when --param binds its parameters", () => {
    /** @scenario "--param binds the statement's own parameters" */
    it("reads each value as the type it looks like", async () => {
      const body = await build({
        flags: { sql: SQL, param: ["since=2026-09-01", "floor=0.5"] },
      });

      expect(body).toMatchObject({
        parameters: { since: "2026-09-01", floor: 0.5 },
      });
    });
  });
});
