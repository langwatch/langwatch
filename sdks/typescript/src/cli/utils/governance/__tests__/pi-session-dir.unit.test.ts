/**
 * Finding pi's session directory when the user has moved it — the flag, the
 * environment variable, and pi's settings file, in pi's own precedence order.
 *
 * Feature: specs/coding-agent/pi-session-capture.feature
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  defaultPiProjectSessionsDir,
  encodePiCwdDirName,
  PI_SESSION_DIR_ENV,
  piSettingsPath,
  resolvePiSessionDir,
  sessionDirFromArgs,
} from "../pi-session-dir";

/** A throwaway HOME, so no test can read or write the real ~/.pi. */
let home: string;

/**
 * A fixed working directory, so the default branch asserts against a known
 * encoded folder name rather than wherever the test runner happens to start.
 */
const cwd = "/work/project";

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lw-pi-session-dir-"));
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const writeSettings = (contents: string) => {
  writeFileSync(piSettingsPath(home), contents);
};

describe("resolving pi's session directory", () => {
  describe("given the directory named on the command line", () => {
    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("reads the session from the directory the flag names", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: ["--model", "sonnet", "--session-dir", "/elsewhere/sessions"],
        env: {},
        home,
      });

      expect(resolved).toBe("/elsewhere/sessions");
    });

    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("reads the joined-up spelling of the same flag", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: ["--session-dir=/elsewhere/sessions"],
        env: {},
        home,
      });

      expect(resolved).toBe("/elsewhere/sessions");
    });

    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("outranks the variable and the settings file", async () => {
      writeSettings(JSON.stringify({ sessionDir: "/from-settings" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: ["--session-dir", "/from-flag"],
        env: { [PI_SESSION_DIR_ENV]: "/from-env" },
        home,
      });

      expect(resolved).toBe("/from-flag");
    });
  });

  describe("given the directory named in the environment", () => {
    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("reads the session from the directory the variable names", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_SESSION_DIR_ENV]: "/from-env" },
        home,
      });

      expect(resolved).toBe("/from-env");
    });

    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("outranks the settings file", async () => {
      writeSettings(JSON.stringify({ sessionDir: "/from-settings" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_SESSION_DIR_ENV]: "/from-env" },
        home,
      });

      expect(resolved).toBe("/from-env");
    });

    it("treats a blank variable as unset", async () => {
      writeSettings(JSON.stringify({ sessionDir: "/from-settings" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_SESSION_DIR_ENV]: "   " },
        home,
      });

      expect(resolved).toBe("/from-settings");
    });
  });

  describe("given the directory named in pi's settings file", () => {
    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("reads the session from the directory the settings name", async () => {
      writeSettings(
        JSON.stringify({ theme: "dark", sessionDir: "/from-settings" }),
      );

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: {},
        home,
      });

      expect(resolved).toBe("/from-settings");
    });
  });

  describe("given nothing has moved the directory", () => {
    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("falls back to the place pi writes by default", async () => {
      writeSettings(JSON.stringify({ theme: "dark" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: {},
        home,
        cwd,
      });

      expect(resolved).toBe(defaultPiProjectSessionsDir({ cwd, home }));
    });

    /**
     * The one that was wrong while every other test here was green: the
     * default is not the sessions folder, it is one folder per working
     * directory inside it, and a reader pointed at the parent sees only
     * directories. Spelling the whole path out is the point — an assertion
     * against `defaultPiProjectSessionsDir` alone would agree with the
     * function however the function encoded it.
     *
     * @scenario "A default pi launch is read from the folder pi makes for this project"
     */
    it("names the per-project folder pi encodes from the working directory", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: {},
        home,
        cwd: "/work/project",
      });

      expect(resolved).toBe(
        join(home, ".pi", "agent", "sessions", "--work-project--"),
      );
      expect(resolved).not.toBe(join(home, ".pi", "agent", "sessions"));
    });

    /** @scenario "A default pi launch is read from the folder pi makes for this project" */
    it("keeps a named directory flat, the way pi uses it", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: ["--session-dir", "/elsewhere/sessions"],
        env: {},
        home,
        cwd: "/work/project",
      });

      expect(resolved).toBe("/elsewhere/sessions");
    });

    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("falls back when there is no settings file at all", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: {},
        home,
        cwd,
      });

      expect(resolved).toBe(defaultPiProjectSessionsDir({ cwd, home }));
    });
  });

  describe("given a settings file that cannot be understood", () => {
    it("falls through to the default rather than throwing on broken JSON", async () => {
      writeSettings('{"sessionDir": "/half-written"');

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, home }));
    });

    it("falls through when the file is not an object", async () => {
      writeSettings('"just a string"');

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, home }));
    });

    it("falls through when sessionDir is not a string", async () => {
      writeSettings(JSON.stringify({ sessionDir: 42 }));

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, home }));
    });

    it("falls through when sessionDir is blank", async () => {
      writeSettings(JSON.stringify({ sessionDir: "  " }));

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, home }));
    });

    it("lets a broken settings file fall through to the variable, not past it", async () => {
      writeSettings("not json at all");

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_SESSION_DIR_ENV]: "/from-env" },
        home,
      });

      expect(resolved).toBe("/from-env");
    });
  });
});

describe("encoding a working directory the way pi names its folder", () => {
  /** @scenario "A default pi launch is read from the folder pi makes for this project" */
  it("drops the leading separator and wraps the rest in double dashes", () => {
    expect(encodePiCwdDirName("/work/project")).toBe("--work-project--");
  });

  /** @scenario "A default pi launch is read from the folder pi makes for this project" */
  it("keeps a dot in a path segment, which pi does not replace", () => {
    expect(encodePiCwdDirName("/a/b/.claude/worktrees/c")).toBe(
      "--a-b-.claude-worktrees-c--",
    );
  });

  /**
   * Both the drive colon and the separator become dashes, and a drive letter
   * has no leading separator to drop, so `C:\` becomes `C--`. That is pi's
   * output, not a tidy one: the first written expectation here was
   * `--C-work-project--` and the run said otherwise.
   */
  it("turns a Windows separator and drive colon into dashes too", () => {
    expect(encodePiCwdDirName("C:\\work\\project")).toBe("--C--work-project--");
  });
});

describe("reading the session directory out of pi's arguments", () => {
  it("finds nothing when the flag is absent", () => {
    expect(sessionDirFromArgs(["--model", "sonnet"])).toBeNull();
  });

  it("finds nothing when the flag ends the arguments", () => {
    expect(sessionDirFromArgs(["--session-dir"])).toBeNull();
  });

  it("does not mistake the next option for a directory", () => {
    expect(sessionDirFromArgs(["--session-dir", "--verbose"])).toBeNull();
  });

  it("does not mistake an empty joined-up value for a directory", () => {
    expect(sessionDirFromArgs(["--session-dir="])).toBeNull();
  });

  it("does not match a flag that merely starts with the same letters", () => {
    expect(sessionDirFromArgs(["--session-dirs", "/nope"])).toBeNull();
  });

  it("keeps a directory whose name starts with a dash out of the value slot", () => {
    // Only the joined-up spelling can name such a directory unambiguously.
    expect(sessionDirFromArgs(["--session-dir=-weird"])).toBe("-weird");
  });

  it("lets a later flag override an earlier one", () => {
    expect(
      sessionDirFromArgs([
        "--session-dir",
        "/first",
        "--session-dir=/second",
      ]),
    ).toBe("/second");
  });

  it("does not read the flag's own value as another flag", () => {
    // The consumed value is skipped, so a directory literally called
    // "--session-dir" cannot shift the parse onto the token after it.
    expect(
      sessionDirFromArgs(["--session-dir", "/real", "trailing"]),
    ).toBe("/real");
  });
});
