import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { lintOxlintBaseline } from "../src/index.ts";

let root = "";

function writeBaseline(directory: string, entries: { key: string; measured: string }[]): void {
  const dir = join(directory, "packages/architecture-lint/src");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "oxlint-baseline.json"), JSON.stringify({ version: 0, entries }));
}

describe("oxlint baseline", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  /** @scenario "The oxlint baseline is shrink-only and every entry carries a measured date" */
  it("passes when the current baseline is a subset of the reference", () => {
    root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
    writeBaseline(root, [
      { key: "cognitive-complexity|apps/api/src/foo.ts", measured: "2026-09-06" },
    ]);

    const reference = mkdtempSync(join(tmpdir(), "oxlint-baseline-ref-"));
    writeBaseline(reference, [
      { key: "cognitive-complexity|apps/api/src/bar.ts", measured: "2026-09-01" },
      { key: "cognitive-complexity|apps/api/src/foo.ts", measured: "2026-09-06" },
    ]);

    expect(
      lintOxlintBaseline(
        root,
        join(reference, "packages/architecture-lint/src/oxlint-baseline.json"),
      ).violations,
    ).toEqual([]);
    rmSync(reference, { recursive: true, force: true });
  });

  /** @scenario "The oxlint baseline is shrink-only and every entry carries a measured date" */
  it("rejects a new entry the reference does not have", () => {
    root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
    writeBaseline(root, [
      { key: "cognitive-complexity|apps/api/src/bar.ts", measured: "2026-09-01" },
      { key: "cognitive-complexity|apps/api/src/foo.ts", measured: "2026-09-06" },
    ]);

    const reference = mkdtempSync(join(tmpdir(), "oxlint-baseline-ref-"));
    writeBaseline(reference, [
      { key: "cognitive-complexity|apps/api/src/bar.ts", measured: "2026-09-01" },
    ]);

    expect(
      lintOxlintBaseline(
        root,
        join(reference, "packages/architecture-lint/src/oxlint-baseline.json"),
      ).violations,
    ).toMatchObject([{ policy: "oxlint-baseline" }]);
    rmSync(reference, { recursive: true, force: true });
  });

  /** @scenario "The oxlint baseline is shrink-only and every entry carries a measured date" */
  it("refuses an entry with no measured date", () => {
    root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));
    const dir = join(root, "packages/architecture-lint/src");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "oxlint-baseline.json"),
      JSON.stringify({
        version: 0,
        entries: [{ key: "cognitive-complexity|apps/api/src/foo.ts" }],
      }),
    );

    expect(lintOxlintBaseline(root).violations).toMatchObject([{ policy: "oxlint-baseline" }]);
  });

  /** @scenario "The oxlint baseline is shrink-only and every entry carries a measured date" */
  it("passes over an absent baseline file", () => {
    root = mkdtempSync(join(tmpdir(), "oxlint-baseline-"));

    expect(lintOxlintBaseline(root).violations).toEqual([]);
  });
});
