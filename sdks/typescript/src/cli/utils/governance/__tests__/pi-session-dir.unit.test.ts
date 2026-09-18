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
  PI_AGENT_DIR_ENV,
  PI_SESSION_DIR_ENV,
  piAgentDir,
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

/**
 * pi's default agent root under the throwaway HOME, written out rather than
 * asked of {@link piAgentDir}, so a test that expects the default is asserting
 * against a literal and not against whatever the resolver currently returns.
 */
const defaultAgentDir = () => join(home, ".pi", "agent");

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "lw-pi-session-dir-"));
  mkdirSync(defaultAgentDir(), { recursive: true });
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

const writeSettings = (contents: string, agentDir = defaultAgentDir()) => {
  writeFileSync(piSettingsPath(agentDir), contents);
};

/** A relocated agent root, created empty, the way `PI_CODING_AGENT_DIR` leaves it. */
const makeAgentDir = (name: string) => {
  const agentDir = join(home, name);
  mkdirSync(agentDir, { recursive: true });
  return agentDir;
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

    /**
     * pi has no `--flag=value` spelling: its parser matches whole tokens and
     * drops `--session-dir=/x` into `unknownFlags`, then writes to its default.
     * Honouring it here pointed capture at a directory pi never filled and
     * reported nothing, so the joined-up form must resolve to the default.
     *
     * The assertion names the default rather than merely "not /elsewhere", so
     * a resolver that threw the argument away and then went wrong somewhere
     * else still fails.
     *
     * @scenario "A directory named in a spelling pi ignores does not move capture"
     */
    it("ignores the joined-up spelling, the way pi ignores it", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: ["--session-dir=/elsewhere/sessions"],
        env: {},
        home,
        cwd,
      });

      expect(resolved).toBe(
        defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }),
      );
      expect(resolved).not.toBe("/elsewhere/sessions");
    });

    /**
     * pi stops reading flags at `--`, so a `--session-dir` behind it is a
     * message, not a relocation.
     *
     * @scenario "A directory named in a spelling pi ignores does not move capture"
     */
    it("stops reading flags at the argument terminator", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: ["--", "--session-dir", "/elsewhere/sessions"],
        env: {},
        home,
        cwd,
      });

      expect(resolved).toBe(
        defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }),
      );
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

    /**
     * pi expands a leading tilde before it writes (`utils/paths.js:58`, called
     * at `core/session-manager.js:1207`), so the directory it writes into is
     * never the literal `~`. For one commit this resolver returned the literal
     * and every session of such a user was missed in silence — the same failure
     * as reading the parent directory, from a different cause.
     *
     * A settings file is where this is unavoidable rather than unlucky: JSON
     * has no expansion of its own, so a user who means their home directory can
     * only write `~`. The assertions below name the expanded path and then say
     * outright that the literal is not it, so reverting the expansion fails
     * here rather than passing on a path nobody reads.
     *
     * @scenario "A session kept somewhere other than the default place is still found"
     */
    it("reads the session from home when the settings start the path at a tilde", async () => {
      writeSettings(JSON.stringify({ sessionDir: "~/pi-sessions" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: {},
        home,
        cwd,
      });

      expect(resolved).toBe(join(home, "pi-sessions"));
      expect(resolved).not.toBe("~/pi-sessions");
      expect(resolved.startsWith("~")).toBe(false);
    });

    /**
     * The same expansion on the two higher-precedence sources. A shell expands
     * an unquoted tilde before pi ever sees it, so these matter for a quoted
     * flag and for a variable set from a file rather than a shell — narrower
     * than the settings case, and the same one-line fix covers them.
     *
     * @scenario "A session kept somewhere other than the default place is still found"
     */
    it("expands a tilde from the flag and from the environment too", async () => {
      writeSettings(JSON.stringify({ theme: "dark" }));

      const fromFlag = await resolvePiSessionDir({
        toolArgs: ["--session-dir", "~/pi-sessions"],
        env: {},
        home,
        cwd,
      });
      const fromEnv = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_SESSION_DIR_ENV]: "~/pi-sessions" },
        home,
        cwd,
      });

      expect(fromFlag).toBe(join(home, "pi-sessions"));
      expect(fromEnv).toBe(join(home, "pi-sessions"));
    });

    /**
     * A tilde that does not start the path is a directory name, not a home
     * reference, and pi leaves it alone. Without this the fix could be written
     * as a replace-anywhere and still look correct.
     *
     * @scenario "A session kept somewhere other than the default place is still found"
     */
    it("leaves a tilde alone when it is part of a directory name", async () => {
      writeSettings(JSON.stringify({ sessionDir: "/srv/~backup/sessions" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: {},
        home,
        cwd,
      });

      expect(resolved).toBe("/srv/~backup/sessions");
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

      expect(resolved).toBe(defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }));
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

    /**
     * The other half of the rule, and the reason the default cannot simply be
     * "always append the project folder": pi applies the encoded folder only
     * when it is choosing the directory itself. A directory the user named is
     * the directory pi writes into, unchanged.
     *
     * @scenario "A session kept somewhere other than the default place is still found"
     */
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

      expect(resolved).toBe(defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }));
    });
  });

  describe("given a settings file that cannot be understood", () => {
    it("falls through to the default rather than throwing on broken JSON", async () => {
      writeSettings('{"sessionDir": "/half-written"');

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }));
    });

    it("falls through when the file is not an object", async () => {
      writeSettings('"just a string"');

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }));
    });

    it("falls through when sessionDir is not a string", async () => {
      writeSettings(JSON.stringify({ sessionDir: 42 }));

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }));
    });

    it("falls through when sessionDir is blank", async () => {
      writeSettings(JSON.stringify({ sessionDir: "  " }));

      await expect(
        resolvePiSessionDir({ toolArgs: [], env: {}, home, cwd }),
      ).resolves.toBe(defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }));
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

  /**
   * `PI_CODING_AGENT_DIR` moves pi's whole agent directory, and with it both
   * places this resolver reads: the settings file (`config.js:440-442`) and the
   * sessions root (`config.js:457-459`), because each is a `join` onto
   * `getAgentDir()` (`config.js:420-426`). A resolver that hard-codes
   * `~/.pi/agent` reads a settings file pi is not writing and walks a sessions
   * tree pi is not filling, and reports no error for either.
   *
   * These tests give the relocated root a name that is not `.pi/agent` and put
   * nothing in the default one, so anything still looking at the default has
   * nowhere to accidentally succeed.
   */
  describe("given pi's whole agent directory has been moved", () => {
    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("looks for the default sessions under the moved agent directory", async () => {
      const agentDir = makeAgentDir("relocated-agent");

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_AGENT_DIR_ENV]: agentDir },
        home,
        cwd: "/work/project",
      });

      expect(resolved).toBe(join(agentDir, "sessions", "--work-project--"));
      expect(resolved.startsWith(defaultAgentDir())).toBe(false);
    });

    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("reads the settings file out of the moved agent directory", async () => {
      const agentDir = makeAgentDir("relocated-agent");
      writeSettings(JSON.stringify({ sessionDir: "/named-in-moved" }), agentDir);
      // The default root holds a settings file naming somewhere else, so
      // reading the wrong one resolves to the wrong directory rather than to
      // the default and can be told apart from simply missing the file.
      writeSettings(JSON.stringify({ sessionDir: "/named-in-default" }));

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_AGENT_DIR_ENV]: agentDir },
        home,
        cwd,
      });

      expect(resolved).toBe("/named-in-moved");
    });

    /**
     * pi passes the variable through `expandTildePath`, which is
     * `normalizePath` with no options (`config.js:408-410`), so a leading tilde
     * is a home reference to pi and never a directory called `~`. JSON is not
     * the only place a user cannot expand one themselves: a variable set from a
     * config file or a `.env` reaches the process unexpanded too.
     *
     * @scenario "A session kept somewhere other than the default place is still found"
     */
    it("expands a tilde in the moved agent directory", async () => {
      const agentDir = makeAgentDir("relocated-agent");

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_AGENT_DIR_ENV]: "~/relocated-agent" },
        home,
        cwd: "/work/project",
      });

      expect(resolved).toBe(join(agentDir, "sessions", "--work-project--"));
      expect(resolved.startsWith("~")).toBe(false);
    });

    /**
     * The two relocations compose rather than compete: the agent directory says
     * WHERE the settings file is, and the settings file still says where the
     * sessions are. Getting this wrong in either direction — reading the
     * default settings, or letting the moved root override a directory the user
     * named — is a separate bug from not reading the variable at all.
     *
     * @scenario "A session kept somewhere other than the default place is still found"
     */
    it("still lets the moved settings file name a session directory of its own", async () => {
      const agentDir = makeAgentDir("relocated-agent");
      writeSettings(JSON.stringify({ sessionDir: "~/pi-sessions" }), agentDir);

      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_AGENT_DIR_ENV]: agentDir },
        home,
        cwd,
      });

      expect(resolved).toBe(join(home, "pi-sessions"));
      expect(resolved.startsWith(agentDir)).toBe(false);
    });

    /** @scenario "A session kept somewhere other than the default place is still found" */
    it("treats a blank agent directory as unset", async () => {
      const resolved = await resolvePiSessionDir({
        toolArgs: [],
        env: { [PI_AGENT_DIR_ENV]: "   " },
        home,
        cwd,
      });

      expect(resolved).toBe(
        defaultPiProjectSessionsDir({ cwd, agentDir: defaultAgentDir() }),
      );
    });

    /**
     * The regression guard for the overwhelmingly common case: nobody sets the
     * variable, and the answer is exactly what it was before it was read at all.
     *
     * @scenario "A default pi launch is read from the folder pi makes for this project"
     */
    it("resolves to pi's own default when the variable is absent", () => {
      expect(piAgentDir({ env: {}, home })).toBe(join(home, ".pi", "agent"));
      expect(piSettingsPath(piAgentDir({ env: {}, home }))).toBe(
        join(home, ".pi", "agent", "settings.json"),
      );
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

  /**
   * pi takes the next token unconditionally, so this really does name a
   * directory called `--verbose` to pi. Reading it as "no directory" left
   * capture on the default while pi wrote elsewhere.
   */
  it("takes a value that looks like a flag, because pi takes it", () => {
    expect(sessionDirFromArgs(["--session-dir", "--verbose"])).toBe("--verbose");
  });

  it("finds nothing in the joined-up spelling, which pi does not accept", () => {
    expect(sessionDirFromArgs(["--session-dir=/joined"])).toBeNull();
    expect(sessionDirFromArgs(["--session-dir="])).toBeNull();
  });

  it("does not match a flag that merely starts with the same letters", () => {
    expect(sessionDirFromArgs(["--session-dirs", "/nope"])).toBeNull();
  });

  it("names a directory that starts with a dash from the value slot", () => {
    expect(sessionDirFromArgs(["--session-dir", "-weird"])).toBe("-weird");
  });

  it("stops at the argument terminator the way pi does", () => {
    expect(sessionDirFromArgs(["--", "--session-dir", "/after"])).toBeNull();
    // The terminator ends parsing, so an earlier flag still stands.
    expect(
      sessionDirFromArgs(["--session-dir", "/before", "--", "--session-dir", "/after"]),
    ).toBe("/before");
  });

  it("lets a later flag override an earlier one", () => {
    expect(
      sessionDirFromArgs([
        "--session-dir",
        "/first",
        "--session-dir",
        "/second",
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
