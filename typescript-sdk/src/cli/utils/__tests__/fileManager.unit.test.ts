import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { FileManager } from "../fileManager";

describe("FileManager.findProjectRoot (via getPromptsConfigPath)", () => {
  let scratchRoot: string;
  let originalCwd: string;

  beforeEach(() => {
    originalCwd = process.cwd();
    scratchRoot = fs.realpathSync(
      fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-fm-")),
    );
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

      expect(FileManager.getPromptsConfigPath()).toBe(
        path.join(sub, "prompts.json"),
      );
    });
  });

  describe("when cwd is inside a project (package.json ancestor) with prompts.json at the root", () => {
    it("walks up to the project root", () => {
      fs.writeFileSync(path.join(scratchRoot, "package.json"), "{}");
      fs.writeFileSync(path.join(scratchRoot, "prompts.json"), "{}");
      const sub = path.join(scratchRoot, "src", "deep");
      fs.mkdirSync(sub, { recursive: true });
      process.chdir(sub);

      expect(FileManager.getPromptsConfigPath()).toBe(
        path.join(scratchRoot, "prompts.json"),
      );
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

      expect(FileManager.getPromptsConfigPath()).toBe(
        path.join(project, "prompts.json"),
      );
    });
  });

  describe("when project has no prompts.json yet", () => {
    it("returns the project-root path so init creates it there", () => {
      fs.writeFileSync(path.join(scratchRoot, "package.json"), "{}");
      const sub = path.join(scratchRoot, "nested");
      fs.mkdirSync(sub);
      process.chdir(sub);

      expect(FileManager.getPromptsConfigPath()).toBe(
        path.join(scratchRoot, "prompts.json"),
      );
    });
  });
});
