import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

/**
 * The protocol under test. Read-only data for every scenario below - no test
 * in this file ever writes to one of these paths.
 */
const COORDINATOR_DIR = ".claude/coordinator";
const CORE_DIR = ".claude/skills/core";
const PROTOCOL_FILES = [
  `${COORDINATOR_DIR}/COORDINATOR.md`,
  `${COORDINATOR_DIR}/LANE.md`,
  `${COORDINATOR_DIR}/README.md`,
  `${COORDINATOR_DIR}/handoff-template.md`,
  `${COORDINATOR_DIR}/manifest-template.md`,
  `${CORE_DIR}/README.md`,
  `${CORE_DIR}/handoff-rules.md`,
  `${CORE_DIR}/repository-rules.md`,
  `${CORE_DIR}/testing-rules.md`,
];

function protocolText(relativePath: string): string {
  return readFileSync(join(root, relativePath), "utf8");
}

describe("the shared rules directory is not itself a discovered skill", () => {
  /** @scenario "The shared rules directory is not itself a discovered skill" */
  it("keeps core un-discoverable while every sibling skill stays discoverable", () => {
    const skillsDir = join(root, ".claude/skills");
    const directories = readdirSync(skillsDir, { withFileTypes: true }).filter((entry) =>
      entry.isDirectory(),
    );
    expect(directories.length).toBeGreaterThan(0);

    const withoutSkillFile = directories
      .filter((entry) => !existsSync(join(skillsDir, entry.name, "SKILL.md")))
      .map((entry) => entry.name);
    expect(withoutSkillFile).toEqual(["core"]);

    const coreReadme = protocolText(`${CORE_DIR}/README.md`);
    expect(coreReadme).toMatch(/not a skill/i);
  });
});

describe("every status named anywhere in the protocol is one of the seven", () => {
  const STATUSES = [
    "ready",
    "in_progress",
    "partial",
    "blocked",
    "review",
    "complete",
    "abandoned",
  ] as const;
  const STATUS_SET = new Set<string>(STATUSES);

  /**
   * Status-shaped tokens, read only from the three structural spots a status
   * actually appears - a table cell, a "Lane reports `x`" event, or a
   * "Status: <a | b | c>" line - never from running prose, where "review" and
   * "complete" are ordinary English words.
   */
  function statusTokensIn(text: string): string[] {
    const found: string[] = [];
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("|")) {
        for (const match of trimmed.matchAll(/`([a-z]+(?:_[a-z]+)?)`/g)) {
          const token = match[1];
          if (token) found.push(token);
        }
      }
      const reported = trimmed.match(/Lane reports `([a-z]+(?:_[a-z]+)?)`/);
      const reportedStatus = reported?.[1];
      if (reportedStatus) found.push(reportedStatus);
      const statusLine = trimmed.match(/^Status:\s*<([^>]+)>/);
      const bracket = statusLine?.[1];
      if (bracket?.includes("|")) {
        found.push(...bracket.split("|").map((token) => token.trim()));
      }
    }
    return found;
  }

  /** @scenario "Every status named anywhere in the protocol is one of the seven" */
  it("rejects a status outside the seven", () => {
    let checked = 0;
    for (const file of PROTOCOL_FILES) {
      for (const token of statusTokensIn(protocolText(file))) {
        checked += 1;
        expect(STATUS_SET.has(token)).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("agrees on all seven between the handoff rules and the handoff template", () => {
    const rulesStatuses = new Set(statusTokensIn(protocolText(`${CORE_DIR}/handoff-rules.md`)));
    const templateStatuses = new Set(
      statusTokensIn(protocolText(`${COORDINATOR_DIR}/handoff-template.md`)),
    );
    expect(rulesStatuses).toEqual(STATUS_SET);
    expect(templateStatuses).toEqual(STATUS_SET);
  });
});

describe("the lane prompt and the repository rules do not contradict each other", () => {
  /** @scenario "The lane prompt and the repository rules do not contradict each other" */
  it("names git mv as the ban and states plain mv is fine, in both files", () => {
    const lane = protocolText(`${COORDINATOR_DIR}/LANE.md`);
    const repository = protocolText(`${CORE_DIR}/repository-rules.md`);

    for (const text of [lane, repository]) {
      expect(text).toContain("`git mv`");
      expect(text).toMatch(/Plain shell `mv`\s+is fine/);
    }
  });
});

describe("a handoff instance is ignored and the directory README is not", () => {
  /** @scenario "A handoff instance is ignored and the directory README is not" */
  it("ignores a runtime instance file while tracking the README and the protocol", () => {
    const probeName = `.probe-${Math.random().toString(36).slice(2)}.md`;
    const handoffProbe = join(root, ".claude/handoffs", probeName);
    const manifestProbe = join(root, ".claude/manifests", probeName);

    function isIgnored(path: string): boolean {
      try {
        execFileSync("git", ["check-ignore", path], { cwd: root });
        return true;
      } catch (error: unknown) {
        const status = (error as { status?: number }).status;
        if (status === 1) return false;
        throw error;
      }
    }

    try {
      writeFileSync(handoffProbe, "probe\n");
      writeFileSync(manifestProbe, "probe\n");

      expect(isIgnored(handoffProbe)).toBe(true);
      expect(isIgnored(manifestProbe)).toBe(true);

      expect(isIgnored(join(root, ".claude/handoffs/README.md"))).toBe(false);
      expect(isIgnored(join(root, ".claude/manifests/README.md"))).toBe(false);

      for (const file of PROTOCOL_FILES.filter((path) => path.startsWith(COORDINATOR_DIR))) {
        expect(isIgnored(join(root, file))).toBe(false);
      }
    } finally {
      rmSync(handoffProbe, { force: true });
      rmSync(manifestProbe, { force: true });
    }
  });
});

describe("every cross-reference in the protocol resolves", () => {
  /** @scenario "Every cross-reference in the protocol resolves" */
  it("finds an existing file for every .claude path the protocol names", () => {
    const pathPattern = /\.claude\/[A-Za-z0-9_.\-/]*\.md/g;
    let checked = 0;
    for (const file of PROTOCOL_FILES) {
      for (const match of protocolText(file).matchAll(pathPattern)) {
        checked += 1;
        expect(existsSync(join(root, match[0]))).toBe(true);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("finds a matching heading for every '<file> section <n>' citation", () => {
    const basenameToPath = new Map(
      PROTOCOL_FILES.map((path) => [path.slice(path.lastIndexOf("/") + 1), path]),
    );
    const citationPattern = /([A-Za-z0-9_.-]+\.md)`?\s*section (\d+)/g;
    let checked = 0;
    for (const file of PROTOCOL_FILES) {
      for (const match of protocolText(file).matchAll(citationPattern)) {
        const citedBasename = match[1];
        const sectionNumber = match[2];
        expect(citedBasename).toBeDefined();
        expect(sectionNumber).toBeDefined();
        if (!citedBasename || !sectionNumber) continue;
        const citedPath = basenameToPath.get(citedBasename);
        expect(citedPath).toBeDefined();
        if (!citedPath) continue;
        checked += 1;
        const headings = protocolText(citedPath).match(/^## (\d+)\./gm) ?? [];
        expect(headings).toContain(`## ${sectionNumber}.`);
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe("the live-lane roster", () => {
  const ROSTER = `${COORDINATOR_DIR}/LANES.md`;

  /** @scenario "The live-lane roster is runtime state and is never committed" */
  it("is ignored by version control like the manifests and handoffs beside it", () => {
    const ignore = readFileSync(join(root, ".gitignore"), "utf8")
      .split("\n")
      .map((line) => line.trim());

    expect(ignore).toContain(ROSTER);
    expect(ignore).toContain(".claude/manifests/*");
    expect(ignore).toContain(".claude/handoffs/*");
  });

  /** @scenario "Spawning a lane is tied to recording it" */
  it("is written before the spawn call, and an empty one is what frees the coordinator", () => {
    const coordinator = protocolText(`${COORDINATOR_DIR}/COORDINATOR.md`);

    const recordsBeforeSpawning = coordinator.indexOf("LANES.md` **before** the Agent call");
    expect(recordsBeforeSpawning).toBeGreaterThan(-1);

    const spawnCall = coordinator.indexOf("`subagent_type` `lane`");
    expect(spawnCall).toBeGreaterThan(recordsBeforeSpawning);

    expect(coordinator).toContain("no `active` rows");
  });
});

describe("the session-start state report", () => {
  const script = "dev/scripts/coordinator-state.sh";

  const runIn = (directory: string) =>
    execFileSync("bash", [join(root, script)], { cwd: directory, encoding: "utf8" });

  /** @scenario "A session is told the drive state without being asked for it" */
  it("says nothing with no drive in progress, and names the next action when there is one", () => {
    const sandbox = mkdtempSync(join(tmpdir(), "coordinator-state-"));

    try {
      // Every session in this repository runs this. Silence is the contract.
      expect(runIn(sandbox)).toBe("");

      mkdirSync(join(sandbox, "dev/docs/plans"), { recursive: true });
      writeFileSync(
        join(sandbox, "dev/docs/plans/handover-2026-01-01.md"),
        "## Exact next action\n\nSpawn the widget lane.\n",
      );

      const reported = runIn(sandbox);
      expect(reported).toContain("Spawn the widget lane.");
      expect(reported).toContain("no lanes active");
    } finally {
      rmSync(sandbox, { recursive: true, force: true });
    }
  });
});
