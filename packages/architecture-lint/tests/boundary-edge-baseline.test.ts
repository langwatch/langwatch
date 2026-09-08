import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  BOUNDARY_EDGE_BASELINE,
  boundaryEdgesFromViolations,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
  shrinkCheck,
} from "../src/index.ts";
import { Temporal } from "@langwatch/time";

function writeFixture(root: string, file: string, source: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

type Edge = { kind: "cross-feature" | "private-runtime-export"; from: string; to: string };

/** The shape the reader takes: rows keyed `<kind>|<from>|<to>`. */
function row(edge: Edge, expires: string): { key: string; measured: string; expires: string } {
  return { key: `${edge.kind}|${edge.from}|${edge.to}`, measured: "2026-09-08", expires };
}

function baselineDocument(entries: readonly unknown[]): unknown {
  return { version: 1, policy: "boundary-edge", entries };
}

function writeBaselineFile(root: string, entries: readonly unknown[]): void {
  writeFixture(
    root,
    "packages/architecture-lint/src/boundary-edge-baseline.json",
    JSON.stringify(baselineDocument(entries)),
  );
}

const edge: Edge = {
  kind: "cross-feature",
  from: "packages/features/dashboard/server/package.json",
  to: "@langwatch/analytics-server",
};

describe("boundary edge baseline (R8)", () => {
  /** @scenario "Legacy edge reconciliation stays out of the hot path" */
  it("stays quiet for a listed edge that has not expired", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-fresh-"));
    writeBaselineFile(root, [row(edge, "2099-01-01")]);

    const check = lintBoundaryEdgeBaseline(
      root,
      [edge],
      void 0,
      Temporal.Instant.from("2026-01-01T00:00:00Z"),
    );

    expect(check.violations).toEqual([]);
    expect(check.entries).toEqual([row(edge, "2099-01-01")]);
  });

  it("fails an edge that is not listed", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-unlisted-"));
    writeBaselineFile(root, []);

    const violations = filterBaselinedBoundaryEdges(
      [
        {
          policy: "cross-feature",
          file: edge.from,
          specifier: edge.to,
          message: "Feature cannot depend on that package.",
        },
      ],
      [],
      Temporal.Instant.from("2026-01-01T00:00:00Z"),
    );

    expect(violations).toHaveLength(1);
  });

  it("silences a listed, unexpired edge and leaves everything else untouched", () => {
    const otherPolicyViolation = {
      policy: "cross-feature",
      file: "packages/features/other/server/package.json",
      specifier: "@langwatch/unrelated-server",
      message: "Feature cannot depend on that package.",
    };
    const listedViolation = {
      policy: edge.kind,
      file: edge.from,
      specifier: edge.to,
      message: "Feature cannot depend on that package.",
    };

    const violations = filterBaselinedBoundaryEdges(
      [listedViolation, otherPolicyViolation],
      [row(edge, "2099-01-01")],
      Temporal.Instant.from("2026-01-01T00:00:00Z"),
    );

    expect(violations).toEqual([otherPolicyViolation]);
  });

  it("reports an expired entry", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-expired-"));
    writeBaselineFile(root, [row(edge, "2020-01-01")]);

    const check = lintBoundaryEdgeBaseline(
      root,
      [edge],
      void 0,
      Temporal.Instant.from("2026-01-01T00:00:00Z"),
    );

    expect(check.violations).toMatchObject([{ policy: "boundary-edge-expired" }]);
  });

  it("reports a stale entry whose edge no longer exists", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-stale-"));
    writeBaselineFile(root, [row(edge, "2099-01-01")]);

    const check = lintBoundaryEdgeBaseline(
      root,
      [],
      void 0,
      Temporal.Instant.from("2026-01-01T00:00:00Z"),
    );

    expect(check.violations).toMatchObject([{ policy: "boundary-edge-baseline-stale" }]);
  });

  it("rejects growth against a merge-base reference: a later expiry or a new edge", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-growth-"));
    const secondEdge: Edge = {
      kind: "private-runtime-export",
      from: "packages/features/new/server/src/index.ts",
      to: "./repositories/prisma/new.repository",
    };
    writeBaselineFile(root, [row(edge, "2099-02-01"), row(secondEdge, "2099-01-01")]);
    writeFixture(
      root,
      "reference/boundary-edge-baseline.json",
      JSON.stringify(baselineDocument([row(edge, "2099-01-01")])),
    );

    const check = lintBoundaryEdgeBaseline(
      root,
      [edge, secondEdge],
      "reference/boundary-edge-baseline.json",
    );

    expect(check.violations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          policy: "boundary-edge-baseline-growth",
          message: expect.stringContaining("move"),
        }),
        expect.objectContaining({
          policy: "boundary-edge-baseline-growth",
          message: expect.stringContaining("cannot add"),
        }),
      ]),
    );
  });

  it("accepts shrinking the baseline against a reference: a dropped edge or an earlier expiry", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-shrink-"));
    writeBaselineFile(root, [row(edge, "2099-01-01")]);
    writeFixture(
      root,
      "reference/boundary-edge-baseline.json",
      JSON.stringify(
        baselineDocument([
          row(edge, "2099-02-01"),
          row(
            {
              kind: "private-runtime-export",
              from: "packages/features/gone/server/src/index.ts",
              to: "./repositories/prisma/gone.repository",
            },
            "2099-01-01",
          ),
        ]),
      ),
    );

    const check = lintBoundaryEdgeBaseline(root, [edge], "reference/boundary-edge-baseline.json");

    expect(check.violations).toEqual([]);
  });

  /** @scenario "A shrink check refuses a key the merge base did not carry" */
  it("compares reference and proposed baselines directly", () => {
    const violations = shrinkCheck({
      reference: [row(edge, "2099-01-01")],
      current: [row(edge, "2099-02-01")],
      policy: BOUNDARY_EDGE_BASELINE,
      file: "boundary-edge-baseline.json",
    });

    expect(violations).toMatchObject([{ policy: "boundary-edge-baseline-growth" }]);
  });

  it("extracts only cross-feature and private-runtime-export edges", () => {
    const edges = boundaryEdgesFromViolations([
      { policy: "cross-feature", file: edge.from, specifier: edge.to, message: "x" },
      {
        policy: "feature-source-layout",
        file: "packages/features/x/server/src/y.ts",
        message: "x",
      },
      {
        policy: "private-runtime-export",
        file: "packages/features/x/server/src/index.ts",
        message: "x",
      },
    ]);

    expect(edges).toEqual([{ kind: "cross-feature", from: edge.from, to: edge.to }]);
  });
});
