import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { FileManager } from "../fileManager";

describe("FileManager.findProjectRoot (via getPromptsConfigPath)", () => {
  let scratchRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    scratchRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-fm-")));
    FileManager._resetProjectRootCache();
  });

  afterEach(() => {
    process.chdir(originalCwd);
    FileManager._resetProjectRootCache();
    fs.rmSync(scratchRoot, { recursive: true, force: true });
  });

  describe("when cwd has no project marker and a stray prompts.json sits above it", () => {
    it("does not climb above cwd", () => {
      const stray = path.join(scratchRoot, "prompts.json");
      fs.writeFileSync(stray, "{}");

      const sub = path.join(scratchRoot, "no-marker-here");
      fs.mkdirSync(sub);
      process.chdir(sub);

      expect(FileManager.getPromptsConfigPath()).toBe(path.join(sub, "prompts.json"));
    });
  });

  describe("when cwd is inside a project (package.json ancestor) with prompts.json at the root", () => {
    it("walks up to the project root", () => {
      fs.writeFileSync(path.join(scratchRoot, "package.json"), "{}");
      fs.writeFileSync(path.join(scratchRoot, "prompts.json"), "{}");
      const sub = path.join(scratchRoot, "src", "deep");
      fs.mkdirSync(sub, { recursive: true });
      process.chdir(sub);

      expect(FileManager.getPromptsConfigPath()).toBe(path.join(scratchRoot, "prompts.json"));
    });
  });

  describe("when prompts.json exists both inside and outside the project boundary", () => {
    it("prefers the in-project one and never crosses the boundary", () => {
      const outerPrompts = path.join(scratchRoot, "prompts.json");
      fs.writeFileSync(outerPrompts, "{}");

      const project = path.join(scratchRoot, "myproj");
      fs.mkdirSync(project);
      fs.writeFileSync(path.join(project, "package.json"), "{}");
      fs.writeFileSync(path.join(project, "prompts.json"), "{}");
      const sub = path.join(project, "src");
      fs.mkdirSync(sub);
      process.chdir(sub);

      expect(FileManager.getPromptsConfigPath()).toBe(path.join(project, "prompts.json"));
    });
  });

  describe("when project has no prompts.json yet", () => {
    it("returns the cwd path so init creates it where the user ran the command", () => {
      fs.writeFileSync(path.join(scratchRoot, "package.json"), "{}");
      const sub = path.join(scratchRoot, "nested");
      fs.mkdirSync(sub);
      process.chdir(sub);

      expect(FileManager.getPromptsConfigPath()).toBe(path.join(sub, "prompts.json"));
    });
  });

  /**
   * Regression: the project-root cache MUST be keyed by the cwd it was derived
   * from, or a second caller from a different directory silently inherits the
   * first's root. No `_resetProjectRootCache()` below -- that is the point.
   */
  describe("given one process serving callers from different directories", () => {
    describe("when the cwd changes between calls", () => {
      it("re-resolves the project root instead of reusing the first caller's", () => {
        const first = path.join(scratchRoot, "caller-one");
        const second = path.join(scratchRoot, "caller-two");
        fs.mkdirSync(first);
        fs.mkdirSync(second);

        process.chdir(first);
        expect(FileManager.getPromptsConfigPath()).toBe(path.join(first, "prompts.json"));

        process.chdir(second);
        expect(FileManager.getPromptsConfigPath()).toBe(path.join(second, "prompts.json"));
      });
    });

    describe("when the cwd is unchanged between calls", () => {
      it("still serves the memoised root", () => {
        const dir = path.join(scratchRoot, "same-caller");
        fs.mkdirSync(dir);
        process.chdir(dir);

        const first = FileManager.getPromptsConfigPath();
        const second = FileManager.getPromptsConfigPath();

        expect(second).toBe(first);
        expect(second).toBe(path.join(dir, "prompts.json"));
      });
    });
  });
});
