import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_WEIGHT_SECONDS,
  balanceShards,
  discover,
  formatMeasured,
  parseOnly,
  parseRegister,
  parseShard,
  parseWeights,
  runPackage,
  scriptsFor,
  shardOf,
  staleEntries,
  summarise,
  type DiscoveredPackage,
  type SuiteOutcome,
} from "./run-package-suites.ts";

/** Records what was run, so a test can assert on what was NOT. */
const recorder = (failing: string[] = []) => {
  const ran: string[] = [];
  const lines: string[] = [];
  return {
    ran,
    lines,
    run: (name: string, script: string) => {
      ran.push(`${name} ${script}`);
      return failing.includes(`${name} ${script}`) || failing.includes(name) ? 1 : 0;
    },
    log: (line: string) => void lines.push(line),
  };
};

const pkg = (name: string, scripts: string[]): DiscoveredPackage => ({
  name,
  dir: `packages/${name.replace(/^@fix\//, "")}`,
  scripts,
});

void describe("given a package's declared scripts", () => {
  void describe("when it declares both test and test:unit", () => {
    void it("runs test:unit and not test, because they are the same suite", () => {
      assert.deepEqual(scriptsFor({ test: "vitest run", "test:unit": "vitest run --unit" }), [
        "test:unit",
      ]);
    });
  });

  void describe("when it declares only test", () => {
    void it("runs test", () => {
      assert.deepEqual(scriptsFor({ test: "vitest run" }), ["test"]);
    });
  });

  void describe("when it declares no suite at all", () => {
    void it("is not discovered, because there is nothing to run", () => {
      assert.deepEqual(scriptsFor({ build: "tsc" }), []);
    });
  });

  void describe("when it declares additional lanes", () => {
    /** @scenario "A package that declares an integration suite has it run" */
    void it("runs every lane, in order, rather than stopping at the first", () => {
      assert.deepEqual(
        scriptsFor({
          test: "vitest run",
          "test:integration": "vitest run -c integration",
          "test:browser": "vitest run -c browser",
        }),
        ["test", "test:integration", "test:browser"],
      );
    });

    /** @scenario "A package whose only suite is an integration suite is still discovered" */
    void it("is discovered when the integration lane is its only suite", () => {
      assert.deepEqual(scriptsFor({ "test:integration": "vitest run -c integration" }), [
        "test:integration",
      ]);
    });

    /** @scenario "A package declaring the browser lane is discovered by CI" */
    void it("is discovered when the browser lane is its only suite", () => {
      assert.deepEqual(scriptsFor({ "test:browser": "vitest run -c browser" }), ["test:browser"]);
    });
  });
});

void describe("given the excluded register", () => {
  void describe("when an entry carries a reason", () => {
    void it("reads the name and the reason", () => {
      const { entries, errors } = parseRegister(
        "@fix/elsewhere  # runs in its own workflow\n",
        "excluded",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(entries, [{ name: "@fix/elsewhere", reason: "runs in its own workflow" }]);
    });
  });

  void describe("when an entry has no reason", () => {
    void it("is an error, because an unexplained entry stops being reviewable", () => {
      const { entries, errors } = parseRegister("@fix/bare\n", "excluded");
      assert.deepEqual(entries, []);
      assert.equal(errors.length, 1);
      assert.match(errors[0]!, /is not '<package>  # why it is here'/);
    });
  });

  void describe("when the file has blanks and whole-line comments", () => {
    void it("skips them", () => {
      const { entries, errors } = parseRegister(
        "# a heading\n\n@fix/a  # one\n\n# another note\n@fix/b  # two\n",
        "excluded",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        entries.map((e) => e.name),
        ["@fix/a", "@fix/b"],
      );
    });
  });

  void describe("when an entry names a package the workspace no longer has", () => {
    void it("is reported, because a dead entry reads as coverage", () => {
      const stale = staleEntries(
        [
          { name: "@fix/gone", reason: "renamed" },
          { name: "@fix/here", reason: "own workflow" },
        ],
        ["@fix/here"],
      );
      assert.deepEqual(stale, ["@fix/gone"]);
    });
  });
});

void describe("given the workspace listing pnpm returns", () => {
  void describe("when a project is the workspace root", () => {
    void it("is not discovered as a package", () => {
      const found = discover([{ name: "@fix/workspace", path: process.cwd() }], process.cwd());
      assert.deepEqual(found, []);
    });
  });

  void describe("when a project has no manifest on disk", () => {
    void it("is skipped rather than throwing", () => {
      const found = discover(
        [{ name: "@fix/ghost", path: `${process.cwd()}/does-not-exist` }],
        process.cwd(),
      );
      assert.deepEqual(found, []);
    });
  });
});

void describe("given a package the gate runs", () => {
  void describe("when every script passes", () => {
    void it("passes, having run each script once", () => {
      const rec = recorder();
      const outcome = runPackage(
        pkg("@fix/two-lane", ["test", "test:integration"]),
        new Map(),
        rec.run,
        rec.log,
      );
      assert.equal(outcome.outcome, "passed");
      assert.deepEqual(rec.ran, ["@fix/two-lane test", "@fix/two-lane test:integration"]);
    });
  });

  void describe("when a later lane fails", () => {
    /** @scenario "A failing integration suite fails the package and names the script" */
    void it("fails the package and names the lane that failed, not the first one", () => {
      const rec = recorder(["@fix/two-lane test:integration"]);
      const outcome = runPackage(
        pkg("@fix/two-lane", ["test", "test:integration"]),
        new Map(),
        rec.run,
        rec.log,
      );
      assert.equal(outcome.outcome, "failed");
      assert.equal(outcome.failedScript, "test:integration");
      assert.ok(rec.lines.some((l) => l.includes("pnpm run test:integration")));
    });

    void it("still runs the remaining lanes, so one push shows every failure", () => {
      const rec = recorder(["@fix/two-lane test"]);
      runPackage(pkg("@fix/two-lane", ["test", "test:integration"]), new Map(), rec.run, rec.log);
      assert.deepEqual(rec.ran, ["@fix/two-lane test", "@fix/two-lane test:integration"]);
    });
  });

  void describe("when the browser lane fails", () => {
    void it("names the browser script rather than the jsdom one", () => {
      const rec = recorder(["@fix/browser test:browser"]);
      const outcome = runPackage(
        pkg("@fix/browser", ["test", "test:browser"]),
        new Map(),
        rec.run,
        rec.log,
      );
      assert.equal(outcome.failedScript, "test:browser");
    });
  });

  void describe("when the package is in the excluded register", () => {
    /** @scenario "An excluded package runs neither of its suites" */
    void it("runs none of its scripts", () => {
      const rec = recorder();
      const outcome = runPackage(
        pkg("@fix/elsewhere", ["test", "test:integration"]),
        new Map([["@fix/elsewhere", "runs in its own workflow"]]),
        rec.run,
        rec.log,
      );
      assert.equal(outcome.outcome, "skipped");
      assert.deepEqual(rec.ran, []);
    });

    void it("says so in the log, because a silent skip reads as never discovered", () => {
      const rec = recorder();
      runPackage(
        pkg("@fix/elsewhere", ["test"]),
        new Map([["@fix/elsewhere", "runs in its own workflow"]]),
        rec.run,
        rec.log,
      );
      assert.ok(
        rec.lines.some((l) => l.includes("not run: @fix/elsewhere — runs in its own workflow")),
      );
    });
  });
});

void describe("given the outcomes of a whole run", () => {
  void describe("when one package failed", () => {
    void it("names it in the summary", () => {
      const outcomes: SuiteOutcome[] = [
        { name: "@fix/green", outcome: "passed" },
        { name: "@fix/red", outcome: "failed", failedScript: "test" },
        { name: "@fix/elsewhere", outcome: "skipped", reason: "own workflow" },
      ];
      const summary = summarise(outcomes).join("\n");
      assert.match(summary, /\| passed \| 1 \|/);
      assert.match(summary, /\| failed \| 1 \|/);
      assert.match(summary, /\| excluded \(registered, not run\) \| 1 \|/);
      assert.match(summary, /Failed: @fix\/red/);
    });
  });

  void describe("when everything passed", () => {
    void it("names no failures", () => {
      const summary = summarise([{ name: "@fix/green", outcome: "passed" }]).join("\n");
      assert.doesNotMatch(summary, /Failed:/);
    });
  });
});

void describe("given the job is split into shards", () => {
  void describe("when every shard of a split takes its share", () => {
    /** @scenario "Every package lands on exactly one shard" */
    void it("runs each package on exactly one shard", () => {
      const items = ["a", "b", "c", "d", "e", "f", "g"].map((name) => ({ name }));
      const weightOf = () => 1;
      const shares = [1, 2, 3].map((index) =>
        shardOf({ items, weightOf, shard: { index, total: 3 } }),
      );
      assert.deepEqual(
        shares
          .flat()
          .map((p) => p.name)
          .toSorted(),
        ["a", "b", "c", "d", "e", "f", "g"],
      );
    });
  });

  void describe("when the packages differ in how long they take", () => {
    const weights = new Map([
      ["slow", 600],
      ["mid", 300],
      ["a", 200],
      ["b", 200],
      ["c", 200],
    ]);
    const items = ["a", "b", "c", "mid", "slow"].map((name) => ({ name }));
    const weightOf = (p: { name: string }) => weights.get(p.name) ?? DEFAULT_WEIGHT_SECONDS;

    /** @scenario "Shards are balanced by measured weight" */
    void it("places the heaviest first, each on the lightest shard", () => {
      const groups = balanceShards({ items, weightOf, total: 2 }).map((g) => g.map((p) => p.name));
      assert.deepEqual(groups, [
        ["c", "slow"],
        ["a", "b", "mid"],
      ]);
    });

    /** @scenario "Every shard computes the same split" */
    void it("gives the same split whatever order the packages arrive in", () => {
      const split = (list: typeof items) =>
        balanceShards({ items: list, weightOf, total: 3 }).map((g) =>
          g.map((p) => p.name).toSorted(),
        );
      assert.deepEqual(split(items), split(items.toReversed()));
    });
  });

  void describe("when a package is missing from the weights", () => {
    /** @scenario "A package with no recorded weight still lands on a shard" */
    void it("is weighed at the default and assigned like any other", () => {
      const { weights } = parseWeights("known  100\n", "weights");
      const weightOf = (p: { name: string }) => weights.get(p.name) ?? DEFAULT_WEIGHT_SECONDS;
      const items = [{ name: "known" }, { name: "new-a" }, { name: "new-b" }];
      assert.equal(weightOf(items[1]), DEFAULT_WEIGHT_SECONDS);
      const placed = balanceShards({ items, weightOf, total: 2 })
        .flat()
        .map((p) => p.name)
        .toSorted();
      assert.deepEqual(placed, ["known", "new-a", "new-b"]);
    });
  });

  void describe("when a pull request narrows the packages", () => {
    /** @scenario "A pull request balances over only the packages it reaches" */
    void it("balances over just the packages given, not the whole workspace", () => {
      const reached = [{ name: "big" }, { name: "small-a" }, { name: "small-b" }];
      const weightOf = (p: { name: string }) => (p.name === "big" ? 300 : 100);
      const groups = balanceShards({ items: reached, weightOf, total: 2 });
      assert.deepEqual(
        groups.map((g) => g.map((p) => p.name)),
        [["big"], ["small-a", "small-b"]],
      );
    });
  });

  void describe("given the weights file", () => {
    /** @scenario "A malformed weights file is refused" */
    void it("reads a package and its seconds, skipping blanks and comments", () => {
      const { weights, errors } = parseWeights(
        "# header\n\n@fix/a  120\n@fix/b 45.5  # note\n",
        "weights",
      );
      assert.deepEqual(errors, []);
      assert.deepEqual(
        [...weights],
        [
          ["@fix/a", 120],
          ["@fix/b", 45.5],
        ],
      );
    });

    void it("refuses a missing, zero, non-numeric, infinite or repeated weight", () => {
      const infinite = `@fix/a  ${"9".repeat(400)}`;
      for (const bad of ["@fix/a", "@fix/a  0", "@fix/a  slow", infinite, "@fix/a 1\n@fix/a 2"]) {
        assert.equal(parseWeights(bad, "weights").errors.length, 1, bad);
      }
    });

    void it("prints the slow packages of a run in its own format", () => {
      assert.deepEqual(
        formatMeasured([
          { name: "@fix/quick", seconds: 3 },
          { name: "@fix/slow", seconds: 120.4 },
          { name: "@fix/slower", seconds: 640 },
        ]),
        ["@fix/slower  640", "@fix/slow  120"],
      );
    });
  });

  void describe("when no shard is named", () => {
    void it("runs everything on one shard", () => {
      assert.deepEqual(parseShard(undefined), { index: 1, total: 1 });
    });
  });

  void describe("when the shard value is malformed", () => {
    /** @scenario "A malformed shard value is refused" */
    void it("refuses it rather than running everything on every leg", () => {
      assert.throws(() => parseShard("0/4"));
      assert.throws(() => parseShard("5/4"));
      assert.throws(() => parseShard("two"));
    });
  });
});

void describe("given the list of projects a pull request reaches", () => {
  void describe("when the list is present", () => {
    /** @scenario "A pull request runs only the suites its change reaches" */
    void it("keeps exactly the named packages", () => {
      const only = parseOnly('["@fix/reached","@fix/also"]');
      assert.deepEqual([...(only ?? [])], ["@fix/reached", "@fix/also"]);
    });
  });

  void describe("when there is no list", () => {
    /** @scenario "Without an affected list every suite runs" */
    void it("narrows nothing", () => {
      assert.equal(parseOnly(undefined), undefined);
      assert.equal(parseOnly(""), undefined);
    });
  });

  void describe("when the list is malformed", () => {
    void it("is an error, never a silent whole or empty run", () => {
      assert.throws(() => parseOnly("not json"), /PACKAGE_SUITES_ONLY/);
      assert.throws(() => parseOnly('{"a":1}'), /PACKAGE_SUITES_ONLY/);
    });
  });
});
