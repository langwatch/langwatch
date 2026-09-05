/**
 * The file tools against a real temporary folder, with a real symlink that
 * points out of it.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { LocalCallFailure } from "../errors";
import {
  editFile,
  findFiles,
  globToRegExp,
  grep,
  insideRoot,
  listDirectory,
  readFile,
  writeFile,
} from "../fs-ops";

describe("given a shared folder with a link that leaves it", () => {
  let base: string;
  let root: string;
  let outside: string;

  beforeEach(() => {
    base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "langy-fs-")));
    root = path.join(base, "project");
    outside = path.join(base, "elsewhere");
    fs.mkdirSync(path.join(root, "src"), { recursive: true });
    fs.mkdirSync(outside, { recursive: true });
    fs.writeFileSync(path.join(outside, "secrets.txt"), "the key\n");
    fs.writeFileSync(
      path.join(root, "src", "app.py"),
      "import os\nprint('hello')\nprint('hello again')\n",
    );
    fs.writeFileSync(path.join(root, "README.md"), "# Acme\n");
    fs.writeFileSync(path.join(root, ".gitignore"), "build/\n*.log\n");
    fs.mkdirSync(path.join(root, "build"));
    fs.writeFileSync(path.join(root, "build", "app.py"), "print('built')\n");
    fs.mkdirSync(path.join(root, "node_modules", "left"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "left", "app.py"),
      "print('vendor')\n",
    );
    fs.symlinkSync(outside, path.join(root, "escape"));
  });

  afterEach(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  describe("when a path resolves outside the folder", () => {
    it("refuses it and names the folder that is allowed", () => {
      const targets = [
        "../elsewhere/secrets.txt",
        path.join(outside, "secrets.txt"),
        "escape/secrets.txt",
        "escape",
      ];
      for (const target of targets) {
        let thrown: unknown;
        try {
          readFile({ params: { path: target }, root });
        } catch (error) {
          thrown = error;
        }
        expect(thrown, target).toBeInstanceOf(LocalCallFailure);
        expect((thrown as LocalCallFailure).code).toBe("path_refused");
        expect((thrown as LocalCallFailure).message).toContain(root);
      }
    });

    it("refuses a write through the link too", () => {
      expect(() =>
        writeFile({
          params: { path: "escape/planted.txt", content: "x" },
          root,
        }),
      ).toThrow(LocalCallFailure);
      expect(fs.existsSync(path.join(outside, "planted.txt"))).toBe(false);
    });

    it("allows a path inside the folder", () => {
      expect(insideRoot({ target: "src/app.py", root })).toBe(
        path.join(root, "src", "app.py"),
      );
    });
  });

  describe("when a file is read", () => {
    it("numbers the lines and honors the offset and the limit", () => {
      const whole = readFile({ params: { path: "src/app.py" }, root });
      expect(whole).toContain("1\timport os");
      expect(whole).toContain("2\tprint('hello')");

      const part = readFile({
        params: { path: "src/app.py", offset: 2, limit: 1 },
        root,
      });
      expect(part).toContain("2\tprint('hello')");
      expect(part).not.toContain("import os");
      expect(part).toContain("more line");
    });

    it("says so when the file is not there", () => {
      let thrown: unknown;
      try {
        readFile({ params: { path: "src/missing.py" }, root });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as LocalCallFailure).code).toBe("not_found");
    });
  });

  describe("when a file is written", () => {
    it("creates the directories it needs", () => {
      const answer = writeFile({
        params: { path: "src/deep/new.py", content: "print('x')\n" },
        root,
      });
      expect(answer).toContain("src/deep/new.py");
      expect(fs.readFileSync(path.join(root, "src/deep/new.py"), "utf8")).toBe(
        "print('x')\n",
      );
    });
  });

  describe("when a file is edited", () => {
    it("applies every replacement in order", () => {
      const answer = editFile({
        params: {
          path: "README.md",
          edits: [{ oldText: "# Acme", newText: "# Acme Shop" }],
        },
        root,
      });
      expect(answer).toContain("1 edit");
      expect(fs.readFileSync(path.join(root, "README.md"), "utf8")).toContain(
        "# Acme Shop",
      );
    });

    it("refuses an old text that is not there", () => {
      let thrown: unknown;
      try {
        editFile({
          params: {
            path: "README.md",
            edits: [{ oldText: "# Nothing", newText: "x" }],
          },
          root,
        });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as LocalCallFailure).message).toContain("is not in");
    });

    it("refuses an old text that is there more than once", () => {
      let thrown: unknown;
      try {
        editFile({
          params: {
            path: "src/app.py",
            edits: [{ oldText: "print('hello", newText: "print('bye" }],
          },
          root,
        });
      } catch (error) {
        thrown = error;
      }
      expect((thrown as LocalCallFailure).message).toContain("2 times");
      expect(fs.readFileSync(path.join(root, "src/app.py"), "utf8")).toContain(
        "print('hello')",
      );
    });
  });

  describe("when the folder is listed", () => {
    it("shows directories first with a trailing slash", () => {
      const listing = listDirectory({ params: {}, root });
      expect(listing).toContain("src/");
      expect(listing).toContain("README.md");
      expect(listing.indexOf("src/")).toBeLessThan(listing.indexOf("README.md"));
    });
  });

  describe("when the folder is searched", () => {
    it("finds the matching lines and skips what git ignores", () => {
      const found = grep({ params: { pattern: "print" }, root });
      expect(found).toContain("src/app.py:2:");
      expect(found).not.toContain("build/app.py");
      expect(found).not.toContain("node_modules");
      expect(found).not.toContain("secrets.txt");
    });

    it("honors the glob and the literal flag", () => {
      expect(
        grep({ params: { pattern: "print", glob: "*.md" }, root }),
      ).toContain("No line matches");
      expect(
        grep({ params: { pattern: "print('hello')", literal: true }, root }),
      ).toContain("src/app.py");
    });
  });

  describe("when files are found by a glob", () => {
    it("matches the pattern and skips what git ignores", () => {
      const found = findFiles({ params: { pattern: "**/*.py" }, root });
      expect(found).toContain("src/app.py");
      expect(found).not.toContain("build/app.py");
      expect(found).not.toContain("node_modules");
    });

    it("reads a glob the way a shell does", () => {
      expect(globToRegExp("*.py").test("app.py")).toBe(true);
      expect(globToRegExp("*.py").test("src/app.py")).toBe(false);
      expect(globToRegExp("**/*.py").test("src/deep/app.py")).toBe(true);
      expect(globToRegExp("**/*.py").test("app.py")).toBe(true);
      expect(globToRegExp("app.?s").test("app.js")).toBe(true);
    });
  });
});
