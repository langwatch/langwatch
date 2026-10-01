import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregatorJobs,
  covers,
  gateFilters,
  inspect,
  listEntries,
  pullRequestFilter,
  stripComment,
} from "./guard-path-filters.ts";

const gated = (onPaths: string[], filterPaths: string[]): string =>
  [
    "name: example",
    "on:",
    "  pull_request:",
    "    paths:",
    ...onPaths.map((p) => `      - "${p}"`),
    "jobs:",
    "  changes:",
    "    runs-on: ubuntu-latest",
    "    steps:",
    "      - uses: dorny/paths-filter@v4",
    "        with:",
    "          filters: |",
    "            relevant:",
    ...filterPaths.map((p) => `              - '${p}'`),
    "  work:",
    "    needs: changes",
    "    runs-on: ubuntu-latest",
  ].join("\n");

void describe("given a workflow that filters the pull-request trigger by path", () => {
  void describe("when every gate filter path is covered", () => {
    void it("reports no issue", () => {
      const source = gated(["pkg/**", "go.mod"], ["pkg/ssrf/address.go", "go.mod"]);
      assert.deepEqual(inspect("example.yml", source), []);
    });
  });

  void describe("when a gate filter names a path on.paths does not cover", () => {
    /** @scenario "A path filter covers every path the workflow's gate consults" */
    void it("reports R1, because that job would silently never run", () => {
      const source = gated(["pkg/**"], ["pkg/ssrf/address.go", "charts/gateway/values.yaml"]);
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R1");
      assert.match(issues[0]?.detail ?? "", /charts\/gateway\/values\.yaml/);
    });
  });

  void describe("when a negated entry excludes a path a broader entry matched", () => {
    /** @scenario "A negated path filter entry removes the coverage it appears to grant" */
    void it("reports R1, because GitHub applies the exclusion and the job never runs", () => {
      const source = gated(["pkg/**", "!pkg/ssrf/**"], ["pkg/ssrf/address.go"]);
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R1");
      assert.match(issues[0]?.detail ?? "", /pkg\/ssrf\/address\.go/);
    });
  });

  void describe("when the workflow also declares an alls-green aggregator", () => {
    /** @scenario "A workflow that filters in on.paths declares no aggregator" */
    void it("reports R2, because a filtered workflow never reports", () => {
      const source = [
        "name: example",
        "on:",
        "  pull_request:",
        "    paths:",
        '      - "pkg/**"',
        "jobs:",
        "  work:",
        "    runs-on: ubuntu-latest",
        "  example-complete:",
        "    needs: [work]",
        "    runs-on: ubuntu-latest",
      ].join("\n");
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R2");
      assert.match(issues[0]?.detail ?? "", /example-complete/);
    });
  });
});

void describe("given a filter shape this guard cannot decompose", () => {
  void describe("when the trigger uses paths-ignore", () => {
    /** @scenario "A filter the guard cannot read is reported, never passed" */
    void it("reports R3 rather than reading as unfiltered", () => {
      const source = [
        "on:",
        "  pull_request:",
        "    paths-ignore:",
        '      - "docs/**"',
        "jobs:",
        "  a:",
      ].join("\n");
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R3");
      assert.match(issues[0]?.detail ?? "", /paths-ignore/);
    });
  });

  void describe("when filters names a file instead of an inline block", () => {
    void it("reports R3, because the declared paths are not visible here", () => {
      const source = [
        "on:",
        "  pull_request:",
        "    paths:",
        '      - "pkg/**"',
        "jobs:",
        "  changes:",
        "    steps:",
        "      - with:",
        "          filters: .github/filters.yml",
      ].join("\n");
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R3");
      assert.match(issues[0]?.detail ?? "", /filters\.yml/);
    });
  });

  void describe("when paths is declared but empty", () => {
    void it("reports R3 rather than treating it as covering nothing", () => {
      const source = ["on:", "  pull_request:", "    paths:", "jobs:", "  a:"].join("\n");
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R3");
    });
  });

  void describe("when the workflow also declares an aggregator", () => {
    void it("still reports R2, because an unreadable filter is still a filter", () => {
      const source = [
        "on:",
        "  pull_request:",
        "    paths-ignore:",
        '      - "docs/**"',
        "jobs:",
        "  work:",
        "  example-complete:",
      ].join("\n");
      const rules = inspect("example.yml", source)
        .map((i) => i.rule)
        .toSorted();
      assert.deepEqual(rules, ["R2", "R3"]);
    });
  });
});

void describe("given a paths key carrying a trailing comment", () => {
  void it("reads the block list beneath it instead of reporting R3", () => {
    const source = [
      "on:",
      "  pull_request:",
      "    paths: # only the Go tree",
      '      - "pkg/**"',
    ].join("\n");
    assert.deepEqual(pullRequestFilter(source), {
      kind: "filtered",
      entries: ["pkg/**"],
    });
  });

  void it("still reads a flow list with a comment after it", () => {
    const source = ["on:", "  pull_request:", '    paths: ["pkg/**"] # why'].join("\n");
    assert.deepEqual(pullRequestFilter(source), {
      kind: "filtered",
      entries: ["pkg/**"],
    });
  });

  void it("keeps a # that YAML treats as scalar content, not a comment", () => {
    const source = ["on:", "  pull_request:", '    paths: ["pkg # b/**"]'].join("\n");
    assert.deepEqual(pullRequestFilter(source), {
      kind: "filtered",
      entries: ["pkg # b/**"],
    });
  });
});

void describe("stripComment", () => {
  void it("drops a comment that starts outside quotes", () => {
    assert.equal(stripComment("paths: # only Go"), "paths:");
    assert.equal(stripComment('paths: ["a"] # why'), 'paths: ["a"]');
  });

  void it("keeps a # inside a quoted scalar", () => {
    assert.equal(stripComment('paths: ["pkg # b/**"]'), 'paths: ["pkg # b/**"]');
    assert.equal(stripComment("paths: ['a#b']"), "paths: ['a#b']");
  });

  void it("requires whitespace before an unquoted # so a#b is not a comment", () => {
    assert.equal(stripComment("paths: a#b"), "paths: a#b");
  });
});

void describe("pullRequestFilter", () => {
  void describe("when the trigger key is quoted", () => {
    void it('still finds the filter, because YAML 1.1 makes "on" a common spelling', () => {
      const source = ['"on":', "  pull_request:", "    paths:", '      - "pkg/**"'].join("\n");
      assert.deepEqual(pullRequestFilter(source), {
        kind: "filtered",
        entries: ["pkg/**"],
      });
    });
  });

  void describe("when paths uses flow style", () => {
    void it("reads the entries", () => {
      const source = ["on:", "  pull_request:", '    paths: ["pkg/**", go.mod]'].join("\n");
      assert.deepEqual(pullRequestFilter(source), {
        kind: "filtered",
        entries: ["pkg/**", "go.mod"],
      });
    });
  });

  void describe("when the workflow uses pull_request_target", () => {
    void it("is filtered just the same", () => {
      const source = ["on:", "  pull_request_target:", "    paths:", "      - a/**"].join("\n");
      assert.deepEqual(pullRequestFilter(source), {
        kind: "filtered",
        entries: ["a/**"],
      });
    });
  });

  void describe("when the workflow declares no path filter", () => {
    void it("reports none", () => {
      assert.deepEqual(pullRequestFilter("on:\n  pull_request:\njobs:\n  a:\n"), {
        kind: "none",
      });
    });
  });

  void describe("when push declares paths but pull_request does not", () => {
    /** @scenario "A push filter is not treated as a pull-request filter" */
    void it("reports none, because only the PR filter is guarded", () => {
      const source = [
        "on:",
        "  push:",
        "    paths:",
        '      - "pkg/**"',
        "  pull_request:",
        "jobs:",
        "  a:",
      ].join("\n");
      assert.deepEqual(pullRequestFilter(source), { kind: "none" });
    });
  });
});

void describe("covers", () => {
  void it("treats a /** suffix as covering everything beneath it", () => {
    assert.equal(covers(["pkg/**"], "pkg/ssrf/address.go"), true);
    assert.equal(covers(["pkg/**"], "pkgother/x.go"), false);
  });

  void it("lets a later negation remove coverage an earlier entry granted", () => {
    assert.equal(covers(["pkg/**", "!pkg/ssrf/**"], "pkg/ssrf/address.go"), false);
    assert.equal(covers(["pkg/**", "!pkg/ssrf/**"], "pkg/other/x.go"), true);
  });

  void it("matches a leading double-star", () => {
    assert.equal(covers(["**/*.go"], "tools/x/y.go"), true);
    assert.equal(covers(["**/*.go"], "tools/x/y.ts"), false);
  });

  void it("matches a middle single-star without crossing a separator", () => {
    assert.equal(covers(["platform/*/prisma/**"], "platform/app/prisma/schema.prisma"), true);
    assert.equal(covers(["platform/*/prisma/**"], "platform/a/b/prisma/schema.prisma"), false);
  });

  void it("requires an exact match for a literal", () => {
    assert.equal(covers(["go.mod"], "go.mod"), true);
    assert.equal(covers(["go.mod"], "go.sum"), false);
  });
});

void describe("listEntries", () => {
  void it("ignores commented-out entries", () => {
    const lines = ["  # - 'commented/out.go'", "  - 'real/path.go'"];
    assert.deepEqual(listEntries(lines), ["real/path.go"]);
  });

  void it("drops a trailing comment, quoted or not", () => {
    assert.deepEqual(listEntries(["  - 'pkg/**' # why", "  - go.mod # also"]), [
      "pkg/**",
      "go.mod",
    ]);
  });
});

void describe("gateFilters", () => {
  void it("reads a folded block scalar", () => {
    const source = [
      "jobs:",
      "  changes:",
      "    steps:",
      "      - with:",
      "          filters: >-",
      "            relevant:",
      "              - 'real/path.go'",
    ].join("\n");
    assert.deepEqual(gateFilters(source), {
      kind: "filtered",
      entries: ["real/path.go"],
    });
  });

  void it("reports none when the workflow has no gate", () => {
    assert.deepEqual(gateFilters("jobs:\n  a:\n"), { kind: "none" });
  });
});

void describe("aggregatorJobs", () => {
  void it("finds only job names ending in -complete", () => {
    const source = ["jobs:", "  build:", "  thing-complete:", "  other:"].join("\n");
    assert.deepEqual(aggregatorJobs(source), ["thing-complete"]);
  });

  void it("reads the job indent from the file rather than assuming two spaces", () => {
    const source = ["jobs:", "    build:", "    thing-complete:"].join("\n");
    assert.deepEqual(aggregatorJobs(source), ["thing-complete"]);
  });

  void it("does not mistake a nested key for a job", () => {
    const source = ["jobs:", "  build:", "    steps:", "    nested-complete:"].join("\n");
    assert.deepEqual(aggregatorJobs(source), []);
  });
});
