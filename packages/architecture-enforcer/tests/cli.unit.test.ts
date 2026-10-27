import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { buildReport, formatReport, POLICY_FINDING_CAP } from "../src/report.ts";
import type { ArchitectureViolation } from "../src/types.ts";
import { writePolicyAnchors } from "./workspace.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(packageRoot, "src/cli.ts");

function runCli(args: readonly string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync(
    process.execPath,
    ["--disable-warning=ExperimentalWarning", "--experimental-transform-types", cli, ...args],
    { encoding: "utf8", cwd: packageRoot },
  );

  return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
}

function writeFixture(root: string, file: string, source: string): void {
  const path = join(root, file);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${source}\n`);
}

/** The records a workspace must hold before any policy can call it sealed. */
function writeSealedWorkspace(root: string): void {
  writeFixture(root, "src/base.ts", "export const base = 1;");
  writeFixture(root, "modules/catalogue.json", '{ "version": 0, "features": [] }');
  writePolicyAnchors(root);
}

/** A committed base plus uncommitted files, so `changedSourceFiles` sees them. */
function gitFixture(name: string): string {
  const root = mkdtempSync(join(tmpdir(), `${name}-`));
  const git = (...args: string[]) =>
    execFileSync("git", ["-C", root, ...args], { stdio: "ignore" });
  git("init", "--quiet", "--initial-branch=main");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Architecture Lint Test");
  git("config", "commit.gpgsign", "false");
  writeSealedWorkspace(root);
  git("add", ".");
  git("commit", "--quiet", "-m", "base");

  return root;
}

function assertionFreeTests(count: number): string {
  const cases = Array.from(
    { length: count },
    (_, index) => `  it("case ${index}", () => {\n    const value = ${index} + 1;\n  });`,
  ).join("\n");

  return `import { describe, it } from "vitest";\n\ndescribe("given a subject", () => {\n${cases}\n});`;
}

function finding(policy: string, file: string, message: string): ArchitectureViolation {
  return { policy, file, line: 1, message, allowed: `Fix ${file}.` };
}

/** No colour codes: every control character but the newline is a formatting escape. */
function controlCharacters(text: string): string[] {
  return text.split("").filter((character) => character !== "\n" && character.codePointAt(0)! < 32);
}

describe("given a report of findings from several policies", () => {
  describe("when the report is formatted", () => {
    /** @scenario "A failing run leads with its summary" */
    it("leads with the totals and a count line per policy, then the findings", () => {
      const report = buildReport([
        finding("alpha", "a.ts", "Alpha refused."),
        finding("alpha", "b.ts", "Alpha refused again."),
        finding("beta", "c.ts", "Beta refused."),
      ]);
      const lines = formatReport(report).split("\n");

      expect(lines[0]).toBe(
        "architecture-enforcer: 3 findings across 2 policies, exit 1 (3 findings)",
      );
      expect(lines.slice(0, 40)).toContain("      2  alpha");
      expect(lines.slice(0, 40)).toContain("      1  beta");
      expect(lines.indexOf("--- alpha: 2 findings ---")).toBeGreaterThan(
        lines.indexOf("      1  beta"),
      );
      expect(lines).toContain("[alpha] a.ts:1");
      expect(lines).toContain("  Alpha refused.");
      expect(lines).toContain("  allowed: Fix a.ts.");
      expect(controlCharacters(formatReport(report))).toEqual([]);
    });
  });

  describe("when one policy reports more findings than the cap", () => {
    const noisy = Array.from({ length: POLICY_FINDING_CAP + 5 }, (_, index) =>
      finding("alpha", `a${index}.ts`, "Alpha refused."),
    );
    const report = buildReport([...noisy, finding("beta", "c.ts", "Beta refused.")]);

    /** @scenario "A noisy policy is capped so the quiet ones stay visible" */
    it("prints the cap, says how many it hid, and prints the quiet policy in full", () => {
      const text = formatReport(report);

      expect(text.match(/^\[alpha\] /gm)).toHaveLength(POLICY_FINDING_CAP);
      expect(text).toContain("5 further findings from alpha, hidden by the cap");
      expect(text.match(/^\[beta\] /gm)).toHaveLength(1);
      expect(text).toContain(`showing at most ${POLICY_FINDING_CAP} findings per policy`);
    });

    /** @scenario "The whole list is available on request" */
    it("prints every finding and drops the cap notice under all", () => {
      const text = formatReport(report, { all: true });

      expect(text.match(/^\[alpha\] /gm)).toHaveLength(POLICY_FINDING_CAP + 5);
      expect(text).not.toContain("hidden by the cap");
      expect(text).not.toContain("pass --all");
    });
  });
});

describe("given a workspace the lint can check", () => {
  describe("when the run ends", () => {
    /** @scenario "The exit code separates a clean tree, a refusal and a misuse" */
    it("exits 0 clean, 1 on a refusal and 2 on an argument it does not know", () => {
      const clean = mkdtempSync(join(tmpdir(), "lint-report-clean-"));
      writeSealedWorkspace(clean);

      const sealed = runCli(["--root", clean, "--no-declarations"]);
      expect(sealed.status).toBe(0);
      expect(sealed.stdout).toContain("architecture-enforcer: package boundaries are sealed");

      const refused = gitFixture("lint-report-refused");
      writeFixture(refused, "src/thing.test.ts", assertionFreeTests(1));
      const failure = runCli(["--root", refused, "--review-test-quality"]);
      expect(failure.status).toBe(1);
      expect(failure.stderr).toContain("exit 1 (1 finding)");

      const unknownPolicy = runCli(["--root", clean, "--policies", "no-such-policy"]);
      expect(unknownPolicy.status).toBe(2);
      expect(unknownPolicy.stderr).toContain("--policies names unknown policy no-such-policy");

      const misuse = runCli(["--root", clean, "--not-a-flag"]);
      expect(misuse.status).toBe(2);
      expect(misuse.stderr).toContain("unknown argument --not-a-flag");
      expect(misuse.stderr).toContain("architecture-enforcer [options]");
    }, 120_000);
  });

  describe("when an anchor a selected policy reads is missing", () => {
    /** @scenario "A missing anchor fails the run by name" */
    it("exits 2 naming the policy and the file rather than reading clean", () => {
      const root = mkdtempSync(join(tmpdir(), "lint-report-anchor-"));
      writeSealedWorkspace(root);
      rmSync(join(root, "packages/prisma-client/prisma/schema.prisma"));

      const selected = runCli(["--root", root, "--policies", "prisma-table-ownership"]);

      expect(selected.status).toBe(2);
      expect(selected.stderr).toContain(
        "prisma-table-ownership: its anchor packages/prisma-client/prisma/schema.prisma does not exist",
      );
    }, 120_000);
  });

  describe("when a policy refuses more than the cap allows", () => {
    /** @scenario "The summary is the first thing a real run prints" */
    it("puts the whole summary in the first 40 lines of the run", () => {
      const root = gitFixture("lint-report-summary");
      writeFixture(root, "src/thing.test.ts", assertionFreeTests(POLICY_FINDING_CAP + 5));

      const capped = runCli(["--root", root, "--review-test-quality"]);
      const lines = capped.stderr.split("\n");

      expect(capped.status).toBe(1);
      expect(lines[0]).toBe(
        `architecture-enforcer: ${POLICY_FINDING_CAP + 5} findings across 1 policy, ` +
          `exit 1 (${POLICY_FINDING_CAP + 5} findings)`,
      );
      expect(lines.slice(0, 40)).toContain(`     ${POLICY_FINDING_CAP + 5}  test-quality`);
      expect(capped.stderr.match(/^\[test-quality\] /gm)).toHaveLength(POLICY_FINDING_CAP);
      expect(capped.stderr).toContain("5 further findings from test-quality, hidden by the cap");

      const all = runCli(["--root", root, "--review-test-quality", "--all"]);
      expect(all.stderr.match(/^\[test-quality\] /gm)).toHaveLength(POLICY_FINDING_CAP + 5);
      expect(all.stderr).not.toContain("hidden by the cap");
    }, 120_000);
  });
});
