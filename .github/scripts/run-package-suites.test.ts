import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  discover,
  parseRegister,
  runPackage,
  scriptsFor,
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
