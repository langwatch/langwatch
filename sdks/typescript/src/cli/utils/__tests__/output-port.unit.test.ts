/**
 * The output PORT, pinned: a command returns data, the port picks the format.
 *
 * Every test here covers a way the CLI could answer a machine caller with
 * human text — or with a fabricated value — at exit 0. That class of bug is
 * invisible to the caller by construction, so it has to be invisible to the
 * test suite too or it comes straight back.
 *
 * The gate that REFUSES a format a command cannot serve is a separate concern
 * and lives in `output-format-gate.unit.test.ts`; the `--jq` subset lives in
 * `output-jq.unit.test.ts`; the wiring into the real tree lives in
 * `output-command-tree.unit.test.ts`.
 */
import { describe, it, expect } from "vitest";
import { Command } from "commander";
import { isOutputAware, registerOutputOptions, emitsResult } from "../output";
import { installOutputHarness } from "./output-harness";

const { logged } = installOutputHarness();

/** A program shaped like the real one: positional options, globals registered. */
const buildProgram = (register: (program: Command) => void): Command => {
  const program = new Command();
  program.exitOverride().enablePositionalOptions().passThroughOptions();
  register(program);
  registerOutputOptions(program);
  return program;
};

describe("emitsResult", () => {
  const PAYLOAD = [
    { id: "a1", name: "first", config: { evaluatorType: "llm" } },
    { id: "b2", name: "second", config: { evaluatorType: "regex" } },
  ];

  const registerListing = (program: Command): void => {
    emitsResult(program.command("list"), () => ({
      data: PAYLOAD,
      table: () => console.log("HUMAN TABLE"),
    }));
  };

  describe("when no format is requested", () => {
    it("renders the human table", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list"], { from: "user" });
      expect(logged).toEqual(["HUMAN TABLE"]);
    });
  });

  describe("when a machine format is requested after the subcommand", () => {
    it("serializes the data instead of the table", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "--output", "json"], { from: "user" });
      expect(logged.join("")).not.toContain("HUMAN TABLE");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });
  });

  // The regression that motivated the port: commander only puts root-position
  // globals on the ROOT command, so anything reading the leaf's opts() drops
  // them — and `lw --output json monitor list` is the spelling the help text
  // teaches, since the root's copies are what render under "Global Options:".
  describe("when a machine format is requested BEFORE the subcommand", () => {
    it("serializes the data, exactly as the trailing spelling does", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["--output", "json", "list"], { from: "user" });
      expect(logged.join("")).not.toContain("HUMAN TABLE");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });

    it("honours a root-position --agent with compact single-line JSON", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["--agent", "list"], { from: "user" });
      expect(logged).toHaveLength(1);
      expect(logged[0]).not.toContain("\n");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });
  });

  describe("when --json selects fields", () => {
    it("projects dotted paths rather than null-filling them", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "--json", "name,config.evaluatorType"], {
        from: "user",
      });
      expect(JSON.parse(logged[0]!)).toEqual([
        { name: "first", "config.evaluatorType": "llm" },
        { name: "second", "config.evaluatorType": "regex" },
      ]);
    });
  });

  describe("when the handler returns nothing", () => {
    it("prints nothing and does not throw", async () => {
      const program = buildProgram((p) => {
        emitsResult(p.command("noop"), () => undefined);
      });
      await program.parseAsync(["noop"], { from: "user" });
      expect(logged).toEqual([]);
    });
  });

  // Counting is a normal thing to want, and the CLI answered it two ways:
  // `pagination.total` on the resource lists, `pagination.totalHits` on the
  // search-backed ones. A caller reading the first got null on a trace search.
  describe("when a paginated envelope names its total", () => {
    const withPagination = (pagination: Record<string, unknown>) =>
      buildProgram((p) => {
        emitsResult(p.command("envelope"), () => ({
          data: { experiments: PAYLOAD, pagination },
          table: () => console.log("HUMAN TABLE"),
        }));
      });

    /** @scenario "A search-backed list also carries the total under the common name" */
    it("adds total beside totalHits", async () => {
      const program = withPagination({ totalHits: 2, hasMore: false });
      await program.parseAsync(["envelope", "-o", "json"], { from: "user" });

      expect(JSON.parse(logged[0]!)).toEqual({
        experiments: PAYLOAD,
        pagination: { totalHits: 2, hasMore: false, total: 2 },
      });
    });

    it("leaves a pagination that already names its total alone", async () => {
      const program = withPagination({ total: 7, page: 1 });
      await program.parseAsync(["envelope", "-o", "json"], { from: "user" });

      expect(JSON.parse(logged[0]!)).toEqual({
        experiments: PAYLOAD,
        pagination: { total: 7, page: 1 },
      });
    });

    /** @scenario "A result with no pagination is left alone" */
    it("leaves a result with no pagination as it was", async () => {
      const program = buildProgram((p) => {
        emitsResult(p.command("bare"), () => ({
          data: { id: "a1", name: "one" },
          table: () => console.log("HUMAN TABLE"),
        }));
      });
      await program.parseAsync(["bare", "-o", "json"], { from: "user" });

      expect(JSON.parse(logged[0]!)).toEqual({ id: "a1", name: "one" });
    });
  });

  // `--limit` is the flag about twenty commands page with, so a caller reads it
  // as universal and the rest answered "unknown option '--limit'" plus a usage
  // dump. It is a projection here, like `--jq`: the command fetched what it
  // fetched, this decides how many rows are printed.
  describe("when --limit caps the result", () => {
    /** @scenario "A list is cut to the first rows on any list command" */
    it("keeps the first n rows of a top-level array", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "-o", "json", "--limit", "1"], {
        from: "user",
      });
      expect(JSON.parse(logged[0]!)).toEqual([PAYLOAD[0]]);
    });

    /** @scenario "A cut list envelope keeps everything it says about itself" */
    it("cuts the rows of a list envelope and keeps its other fields", async () => {
      const program = buildProgram((p) => {
        emitsResult(p.command("envelope"), () => ({
          data: { experiments: PAYLOAD, pagination: { totalHits: 2 } },
          table: () => console.log("HUMAN TABLE"),
        }));
      });
      await program.parseAsync(["envelope", "-o", "json", "--limit", "1"], {
        from: "user",
      });
      // `total` is added beside the field the API sent, so a caller has one
      // name to read on every list. Nothing is taken away.
      expect(JSON.parse(logged[0]!)).toEqual({
        experiments: [PAYLOAD[0]],
        pagination: { totalHits: 2, total: 2 },
      });
    });

    /** @scenario "The total survives a capped page" */
    it("keeps the total of the whole list, not the size of the page", async () => {
      const program = buildProgram((p) => {
        emitsResult(p.command("envelope"), () => ({
          data: { experiments: PAYLOAD, pagination: { totalHits: 40 } },
          table: () => console.log("HUMAN TABLE"),
        }));
      });
      await program.parseAsync(["envelope", "-o", "json", "--limit", "1"], {
        from: "user",
      });
      const printed = JSON.parse(logged[0]!) as {
        experiments: unknown[];
        pagination: { total: number };
      };
      expect(printed.experiments).toHaveLength(1);
      expect(printed.pagination.total).toBe(40);
    });

    /** @scenario "A payload that is not a list is left whole" */
    it("leaves a payload with no single list alone", async () => {
      const program = buildProgram((p) => {
        emitsResult(p.command("one"), () => ({
          data: { id: "a1", tags: ["x"], versions: ["v1", "v2"] },
          table: () => console.log("HUMAN TABLE"),
        }));
      });
      await program.parseAsync(["one", "-o", "json", "--limit", "1"], {
        from: "user",
      });
      expect(JSON.parse(logged[0]!)).toEqual({
        id: "a1",
        tags: ["x"],
        versions: ["v1", "v2"],
      });
    });

    /** @scenario "A command with its own paging flag keeps it" */
    it("never caps on top of a command's own --limit", async () => {
      let seen: string | undefined;
      const program = buildProgram((p) => {
        emitsResult(
          p
            .command("paged")
            .option("--limit <n>", "Rows fetched per page; the walk covers all"),
          (options: { limit?: string }) => {
            seen = options.limit;
            return { data: PAYLOAD, table: () => console.log("HUMAN TABLE") };
          },
        );
      });
      await program.parseAsync(["paged", "-o", "json", "--limit", "1"], {
        from: "user",
      });
      expect(seen).toBe("1");
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });

    it("counts what is left when --jq follows it", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "--limit", "1", "--jq", "length"], {
        from: "user",
      });
      expect(JSON.parse(logged[0]!)).toBe(1);
    });

    it("ignores a limit that is not a positive number", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "-o", "json", "--limit", "nonsense"], {
        from: "user",
      });
      expect(JSON.parse(logged[0]!)).toEqual(PAYLOAD);
    });

    it("leaves the human table alone", async () => {
      const program = buildProgram(registerListing);
      await program.parseAsync(["list", "--limit", "1"], { from: "user" });
      expect(logged).toEqual(["HUMAN TABLE"]);
    });
  });
});

describe("isOutputAware", () => {
  it("tells a migrated command from one that prints its own output", () => {
    const program = new Command();
    const migrated = emitsResult(program.command("migrated"), () => ({
      data: {},
      table: () => undefined,
    }));
    const legacy = program.command("legacy").action(() => undefined);

    expect(isOutputAware(migrated)).toBe(true);
    expect(isOutputAware(legacy)).toBe(false);
  });
});
