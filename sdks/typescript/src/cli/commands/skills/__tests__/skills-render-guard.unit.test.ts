/**
 * Pins the render guard. The CLI bundle is built from `_compiled/cli` (login
 * steps kept). The Langy image builds the CLI with LANGWATCH_SKILLS_RENDER=native,
 * so Langy's bash tool, which can run that binary, never sees login steps.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { renderModeDir } from "../../../../../scripts/skills-render-mode.mjs";

const REPO_ROOT = path.join(__dirname, "../../../../../../../");
const SKILLS_ROOT = path.join(REPO_ROOT, "skills");

const setupLwFor = (mode: string): string =>
  fs.readFileSync(
    path.join(SKILLS_ROOT, "_compiled", renderModeDir(mode), "setup-lw", "SKILL.md"),
    "utf8",
  );

describe("renderModeDir", () => {
  /** @scenario "Building the CLI without choosing a render bundles the cli render" */
  it("defaults to the cli render when the env var is unset", () => {
    expect(renderModeDir(undefined)).toBe("cli");
  });

  it("accepts cli and native", () => {
    expect(renderModeDir("cli")).toBe("cli");
    expect(renderModeDir("native")).toBe("native");
  });

  /** @scenario "An unknown render value fails the build" */
  it("rejects any other value with a clear error", () => {
    expect(() => renderModeDir("nativ")).toThrow(
      /LANGWATCH_SKILLS_RENDER must be one of cli, native/,
    );
    expect(() => renderModeDir("")).toThrow(/got ""/);
  });
});

describe("the skills render guard", () => {
  /** @scenario "The native render leaves the sign-in steps out" */
  it("native mode bundles setup-lw without login steps", () => {
    expect(setupLwFor("native")).not.toContain("langwatch login");
  });

  /** @scenario "The cli render keeps every sign-in step its skills import" */
  it("cli mode bundles setup-lw with login steps", () => {
    expect(setupLwFor("cli")).toContain("langwatch login");
  });

  /** @scenario "The Langy image builds its CLI with the native render" */
  it("Dockerfile.langyagent sets LANGWATCH_SKILLS_RENDER=native on its generate step", () => {
    const dockerfile = fs.readFileSync(
      path.join(REPO_ROOT, "infra/docker/Dockerfile.langyagent"),
      "utf8",
    );
    const generateSteps = dockerfile
      .split("\n")
      .filter((line) => /^RUN\b.*pnpm run generate\b/.test(line));
    expect(generateSteps).toEqual(["RUN LANGWATCH_SKILLS_RENDER=native pnpm run generate"]);
  });
});
