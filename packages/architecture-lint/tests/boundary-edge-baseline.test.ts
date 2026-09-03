import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  boundaryEdgesFromViolations,
  compareBoundaryEdgeBaseline,
  filterBaselinedBoundaryEdges,
  lintBoundaryEdgeBaseline,
} from "../src";

function writeFixture(root: string, file: string, source: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, source);
}

function writeBaselineFile(root: string, contents: unknown): void {
  writeFixture(
    root,
    "packages/architecture-lint/src/boundary-edge-baseline.json",
    JSON.stringify(contents),
  );
}

const edge = {
  kind: "cross-feature" as const,
  from: "packages/features/dashboard/server/package.json",
  to: "@langwatch/analytics-server",
};

describe("boundary edge baseline (R8)", () => {
  it("stays quiet for a listed edge that has not expired", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-fresh-"));
    writeBaselineFile(root, {
      version: 0,
      edges: [{ ...edge, expires: "2099-01-01" }],
    });

    const check = lintBoundaryEdgeBaseline(root, [edge], void 0, new Date("2026-01-01T00:00:00Z"));

    expect(check.violations).toEqual([]);
    expect(check.entries).toEqual([{ ...edge, expires: "2099-01-01" }]);
  });

  it("fails an edge that is not listed", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-unlisted-"));
    writeBaselineFile(root, { version: 0, edges: [] });

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
      new Date("2026-01-01T00:00:00Z"),
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
      [{ ...edge, expires: "2099-01-01" }],
      new Date("2026-01-01T00:00:00Z"),
    );

    expect(violations).toEqual([otherPolicyViolation]);
  });

  it("reports an expired entry", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-expired-"));
    writeBaselineFile(root, { version: 0, edges: [{ ...edge, expires: "2020-01-01" }] });

    const check = lintBoundaryEdgeBaseline(root, [edge], void 0, new Date("2026-01-01T00:00:00Z"));

    expect(check.violations).toMatchObject([{ policy: "boundary-edge-expired" }]);
  });

  it("reports a stale entry whose edge no longer exists", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-stale-"));
    writeBaselineFile(root, { version: 0, edges: [{ ...edge, expires: "2099-01-01" }] });

    const check = lintBoundaryEdgeBaseline(root, [], void 0, new Date("2026-01-01T00:00:00Z"));

    expect(check.violations).toMatchObject([{ policy: "boundary-edge-baseline-stale" }]);
  });

  it("rejects growth against a merge-base reference: a later expiry or a new edge", () => {
    const root = mkdtempSync(join(tmpdir(), "boundary-edge-growth-"));
    const secondEdge = {
      kind: "private-runtime-export" as const,
      from: "packages/features/new/server/src/index.ts",
      to: "./repositories/prisma/new.repository",
    };
    writeBaselineFile(root, {
      version: 0,
      edges: [
        { ...edge, expires: "2099-02-01" },
        { ...secondEdge, expires: "2099-01-01" },
      ],
    });
    writeFixture(
      root,
      "reference/boundary-edge-baseline.json",
      JSON.stringify({ version: 0, edges: [{ ...edge, expires: "2099-01-01" }] }),
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
    writeBaselineFile(root, { version: 0, edges: [{ ...edge, expires: "2099-01-01" }] });
    writeFixture(
      root,
      "reference/boundary-edge-baseline.json",
      JSON.stringify({
        version: 0,
        edges: [
          { ...edge, expires: "2099-02-01" },
          {
            kind: "private-runtime-export",
            from: "packages/features/gone/server/src/index.ts",
            to: "./repositories/prisma/gone.repository",
            expires: "2099-01-01",
          },
        ],
      }),
    );

    const check = lintBoundaryEdgeBaseline(root, [edge], "reference/boundary-edge-baseline.json");

    expect(check.violations).toEqual([]);
  });

  it("compares reference and proposed baselines directly", () => {
    const violations = compareBoundaryEdgeBaseline(
      [{ ...edge, expires: "2099-01-01" }],
      [{ ...edge, expires: "2099-02-01" }],
      "boundary-edge-baseline.json",
    );

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
