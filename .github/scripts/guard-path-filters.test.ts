import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  aggregatorJobs,
  covers,
  gateFilterPaths,
  inspect,
  pullRequestPaths,
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

describe("given a workflow that filters in on.pull_request.paths", () => {
  describe("when every gate filter path is covered", () => {
    it("reports no issue", () => {
      const source = gated(["pkg/**", "go.mod"], ["pkg/ssrf/address.go", "go.mod"]);
      assert.deepEqual(inspect("example.yml", source), []);
    });
  });

  describe("when a gate filter names a path on.paths does not cover", () => {
    /** @scenario "A path filter covers every path the workflow's gate consults" */
    it("reports R1, because that job would silently never run", () => {
      const source = gated(["pkg/**"], ["pkg/ssrf/address.go", "charts/gateway/values.yaml"]);
      const issues = inspect("example.yml", source);
      assert.equal(issues.length, 1);
      assert.equal(issues[0]?.rule, "R1");
      assert.match(issues[0]?.detail ?? "", /charts\/gateway\/values\.yaml/);
    });
  });

  describe("when the workflow also declares an alls-green aggregator", () => {
    /** @scenario "A workflow that filters in on.paths declares no aggregator" */
    it("reports R2, because a filtered workflow never reports", () => {
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

describe("given a workflow with no on.pull_request.paths", () => {
  describe("when it keeps the always-run gate and aggregator", () => {
    it("reports nothing, because that is the pattern required checks need", () => {
      const source = [
        "name: example",
        "on:",
        "  pull_request:",
        "jobs:",
        "  changes:",
        "    runs-on: ubuntu-latest",
        "    steps:",
        "      - uses: dorny/paths-filter@v4",
        "        with:",
        "          filters: |",
        "            relevant:",
        "              - 'anything/at/all'",
        "  example-complete:",
        "    runs-on: ubuntu-latest",
      ].join("\n");
      assert.deepEqual(inspect("example.yml", source), []);
    });
  });
});

describe("pullRequestPaths", () => {
  describe("when the workflow declares none", () => {
    it("returns null rather than an empty list", () => {
      assert.equal(pullRequestPaths("on:\n  pull_request:\njobs:\n  a:\n"), null);
    });
  });

  describe("when push declares paths but pull_request does not", () => {
    /** @scenario "A push filter is not treated as a pull-request filter" */
    it("still returns null, because only the PR filter is guarded", () => {
      const source = [
        "on:",
        "  push:",
        "    paths:",
        '      - "pkg/**"',
        "  pull_request:",
        "jobs:",
        "  a:",
      ].join("\n");
      assert.equal(pullRequestPaths(source), null);
    });
  });
});

describe("covers", () => {
  it("treats a /** suffix as covering everything beneath it", () => {
    assert.equal(covers("pkg/**", "pkg/ssrf/address.go"), true);
    assert.equal(covers("pkg/**", "pkgother/x.go"), false);
  });

  it("requires an exact match otherwise", () => {
    assert.equal(covers("go.mod", "go.mod"), true);
    assert.equal(covers("go.mod", "go.sum"), false);
  });
});

describe("gateFilterPaths", () => {
  it("ignores commented-out entries", () => {
    const source = [
      "jobs:",
      "  changes:",
      "    steps:",
      "      - with:",
      "          filters: |",
      "            relevant:",
      "              # - 'commented/out.go'",
      "              - 'real/path.go'",
    ].join("\n");
    assert.deepEqual(gateFilterPaths(source), ["real/path.go"]);
  });
});

describe("aggregatorJobs", () => {
  it("finds only job names ending in -complete", () => {
    const source = ["jobs:", "  build:", "  thing-complete:", "  other:"].join("\n");
    assert.deepEqual(aggregatorJobs(source), ["thing-complete"]);
  });
});
