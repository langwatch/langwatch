import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  collectForwardedEnv,
  evaluateEligibility,
  isAutoSpawnEnabled,
  isDaemonDisabledByConfig,
  resolveColorLevel,
  stdinCarriesData,
  type EligibilityInput,
} from "../eligibility";

const piped = (overrides: Partial<EligibilityInput> = {}): EligibilityInput => ({
  args: ["trace", "search", "--format", "json"],
  env: {},
  stdoutIsTty: false,
  stderrIsTty: false,
  stdinIsTty: false,
  stdinCarriesData: false,
  platform: "darwin",
  ...overrides,
});

describe("evaluateEligibility", () => {
  describe("given an agent piping the CLI output", () => {
    it("allows the daemon to serve the command", () => {
      expect(evaluateEligibility(piped())).toEqual({ eligible: true });
    });
  });

  describe("given a human at a terminal", () => {
    it("refuses when stdout is a TTY", () => {
      expect(evaluateEligibility(piped({ stdoutIsTty: true }))).toEqual({
        eligible: false,
        reason: "interactive-tty",
      });
    });

    it("refuses when only stdin is a TTY", () => {
      expect(evaluateEligibility(piped({ stdinIsTty: true }))).toEqual({
        eligible: false,
        reason: "interactive-tty",
      });
    });

    it("refuses when only stderr is a TTY", () => {
      expect(evaluateEligibility(piped({ stderrIsTty: true }))).toEqual({
        eligible: false,
        reason: "interactive-tty",
      });
    });
  });

  describe("when the user opts out via LANGWATCH_NO_DAEMON", () => {
    it("refuses", () => {
      expect(
        evaluateEligibility(piped({ env: { LANGWATCH_NO_DAEMON: "1" } })),
      ).toEqual({ eligible: false, reason: "disabled-by-env" });
    });

    it("ignores an explicit falsy value", () => {
      expect(
        evaluateEligibility(piped({ env: { LANGWATCH_NO_DAEMON: "0" } })),
      ).toEqual({ eligible: true });
    });
  });

  describe("when the user opts out persistently (`config set daemon off`)", () => {
    it("refuses", () => {
      expect(
        evaluateEligibility(piped({ daemonDisabledByConfig: true })),
      ).toEqual({ eligible: false, reason: "disabled-by-config" });
    });

    it("lets the per-invocation env opt-out keep its own reason", () => {
      expect(
        evaluateEligibility(
          piped({
            env: { LANGWATCH_NO_DAEMON: "1" },
            daemonDisabledByConfig: true,
          }),
        ),
      ).toEqual({ eligible: false, reason: "disabled-by-env" });
    });
  });

  /**
   * The daemon is spawned with `stdio: "ignore"` (spawn.ts), so its fd 0 is
   * /dev/null. A caller who is PIPING data in is therefore the one shape it can
   * least serve — while being, on a TTY check alone, indistinguishable from the
   * agent this whole feature exists for.
   */
  describe("given a caller whose stdin carries data", () => {
    /** @scenario "A command reads the caller's standard input" */
    it("refuses a piped stdin, which no terminal check would have caught", () => {
      expect(
        evaluateEligibility(
          piped({
            args: ["dataset", "records", "add", "my-ds", "--stdin"],
            stdinCarriesData: true,
          }),
        ),
      ).toEqual({ eligible: false, reason: "piped-stdin" });
    });

    it("refuses a piped stdin whatever the command is", () => {
      // Served, `readStdin()` would resolve "" on the daemon's immediate EOF —
      // and the SECOND such request would never settle at all, because
      // process.stdin has already emitted `end`.
      expect(
        evaluateEligibility(piped({ stdinCarriesData: true })),
      ).toEqual({ eligible: false, reason: "piped-stdin" });
    });

    it("refuses --stdin even when fd 0 could not be inspected", () => {
      expect(
        evaluateEligibility(
          piped({ args: ["dataset", "records", "add", "my-ds", "--stdin"] }),
        ),
      ).toEqual({ eligible: false, reason: "reads-stdin" });
    });

    it("still serves the same command when nothing is piped in", () => {
      expect(
        evaluateEligibility(
          piped({
            args: ["dataset", "records", "add", "my-ds", "--file", "rows.json"],
          }),
        ),
      ).toEqual({ eligible: true });
    });
  });

  describe("when the command prompts on stdin", () => {
    /** @scenario "A command asks me a question at a prompt" */
    it("refuses push, whose conflict prompt would never be answered", () => {
      expect(evaluateEligibility(piped({ args: ["push"] }))).toEqual({
        eligible: false,
        reason: "denied-command",
      });
    });

    /** @scenario "A command asks me a question at a prompt" */
    it("refuses prompt tag delete, which confirms by typing the tag name", () => {
      expect(
        evaluateEligibility(piped({ args: ["prompt", "tag", "delete", "prod"] })),
      ).toEqual({ eligible: false, reason: "denied-command" });
    });

    it("keeps serving the tag commands that never prompt", () => {
      expect(
        evaluateEligibility(piped({ args: ["prompt", "tag", "list"] })),
      ).toEqual({ eligible: true });
    });

    it("keeps serving a --tag VALUE, which the phrase rule exists to spare", () => {
      // Denying the bare word `tag` would have taken this with it.
      expect(
        evaluateEligibility(piped({ args: ["pull", "--tag", "production"] })),
      ).toEqual({ eligible: true });
    });
  });

  describe("when the command reads the caller's own environment", () => {
    // The forwarded-env allowlist carries neither the session identity
    // (CLAUDE_CODE_SESSION_ID) nor TRACEPARENT nor CODEX_HOME, so a
    // daemon-served declaration resolves the wrong session or none.
    it.each([
      [["ingest", "context"]],
      [["ingest", "guidance", "claude-code"]],
    ])("refuses %j", (args) => {
      expect(evaluateEligibility(piped({ args }))).toEqual({
        eligible: false,
        reason: "denied-command",
      });
    });

    it("keeps serving the other ingest commands", () => {
      expect(evaluateEligibility(piped({ args: ["ingest", "list"] }))).toEqual({
        eligible: true,
      });
    });
  });

  describe("when the command mutates identity or takes over stdio", () => {
    it.each([
      ["login"],
      ["logout"],
      ["config"],
      ["open"],
      ["claude"],
      ["codex"],
      ["cursor"],
      ["gemini"],
      ["opencode"],
      ["daemon"],
      ["instrument"],
      ["report"],
      ["push"],
    ])("refuses %s", (command) => {
      expect(evaluateEligibility(piped({ args: [command] }))).toEqual({
        eligible: false,
        reason: "denied-command",
      });
    });

    it("finds the command name past leading flags", () => {
      expect(
        evaluateEligibility(piped({ args: ["--verbose", "login"] })),
      ).toEqual({ eligible: false, reason: "denied-command" });
    });
  });

  describe("when a value-taking global option comes before the command", () => {
    // The root program's `-o <format>`, `--json <fields>` and `--jq <expr>`
    // parse ahead of the subcommand, so the first bare word is the option's
    // VALUE, not the command. Reading it as the command let `-o json open`
    // through to a daemon with no display environment and stdio on /dev/null:
    // no browser opened, and for the wrappers the caller's output vanished.
    it.each([
      [["-o", "json", "open", "/traces"]],
      [["--output", "json", "logout"]],
      [["-o", "json", "claude", "-p", "summarise this"]],
      [["--json", "id,name", "config", "set", "daemon", "off"]],
      [["--jq", ".projects[].id", "login"]],
    ])("refuses %j", (args) => {
      expect(evaluateEligibility(piped({ args }))).toEqual({
        eligible: false,
        reason: "denied-command",
      });
    });

    it("still serves an allowed command behind the same option", () => {
      expect(
        evaluateEligibility(piped({ args: ["-o", "json", "trace", "search"] })),
      ).toEqual({ eligible: true });
    });
  });

  describe("when a denied name appears somewhere other than the command", () => {
    it("refuses anyway, because a needless cold start is the cheap mistake", () => {
      expect(
        evaluateEligibility(piped({ args: ["prompt", "get", "open"] })),
      ).toEqual({ eligible: false, reason: "denied-command" });
    });
  });

  describe("when the command would never terminate", () => {
    it("refuses --follow", () => {
      expect(
        evaluateEligibility(
          piped({ args: ["ingest", "tail", "src-1", "--follow"] }),
        ),
      ).toEqual({ eligible: false, reason: "long-running-flag" });
    });
  });

  describe("when no command is given", () => {
    it("refuses a bare invocation", () => {
      expect(evaluateEligibility(piped({ args: [] }))).toEqual({
        eligible: false,
        reason: "no-command",
      });
    });

    it("refuses --help", () => {
      expect(evaluateEligibility(piped({ args: ["--help"] }))).toEqual({
        eligible: false,
        reason: "no-command",
      });
    });

    // A global option's VALUE is a bare word too, so `-o json` used to read as
    // the command `json` and reach the daemon, which then rendered the root
    // help for an invocation there was nothing to warm for. (Which bin name
    // that help carries is settled separately, by `ExecFrame.bin`.)
    it.each([
      [["-o", "json"]],
      [["--output", "yaml"]],
      [["--jq", ".projects[].id"]],
      [["--json", "id,name"]],
      [["-o", "json", "--jq", ".id"]],
    ])("refuses %j, which names no command at all", (args) => {
      expect(evaluateEligibility(piped({ args }))).toEqual({
        eligible: false,
        reason: "no-command",
      });
    });

    it("still serves a command that follows a global option's value", () => {
      expect(
        evaluateEligibility(piped({ args: ["-o", "json", "trace", "list"] })),
      ).toEqual({ eligible: true });
    });

    it("still serves a command behind a boolean global option", () => {
      // `--agent` takes no value, so `trace` is the command — and `list`,
      // following an operand rather than a flag, is what proves it.
      expect(
        evaluateEligibility(piped({ args: ["--agent", "trace", "list"] })),
      ).toEqual({ eligible: true });
    });

    it("reads an option that carries its own value as not eating the command", () => {
      expect(
        evaluateEligibility(piped({ args: ["--output=json", "trace"] })),
      ).toEqual({ eligible: true });
    });
  });

  describe("given windows", () => {
    it("refuses, because the socket permission model does not exist there", () => {
      expect(evaluateEligibility(piped({ platform: "win32" }))).toEqual({
        eligible: false,
        reason: "unsupported-platform",
      });
    });
  });
});

describe("collectForwardedEnv", () => {
  describe("given an environment full of unrelated secrets", () => {
    it("forwards LANGWATCH_* and the output/proxy knobs only", () => {
      const forwarded = collectForwardedEnv({
        LANGWATCH_API_KEY: "sk-test",
        LANGWATCH_ENDPOINT: "https://example.test",
        FORCE_COLOR: "3",
        HTTPS_PROXY: "http://proxy.test",
        AWS_SECRET_ACCESS_KEY: "super-secret",
        GITHUB_TOKEN: "ghp_secret",
        PATH: "/usr/bin",
      });

      expect(forwarded).toEqual({
        LANGWATCH_API_KEY: "sk-test",
        LANGWATCH_ENDPOINT: "https://example.test",
        FORCE_COLOR: "3",
        HTTPS_PROXY: "http://proxy.test",
      });
    });

    it("does not leak an unrelated secret into the daemon", () => {
      const forwarded = collectForwardedEnv({ AWS_SESSION_TOKEN: "leak-me" });
      expect(forwarded).not.toHaveProperty("AWS_SESSION_TOKEN");
    });
  });
});

describe("resolveColorLevel", () => {
  describe("given a piped caller with no colour env", () => {
    it("resolves no colour, matching chalk on a non-TTY stream", () => {
      expect(resolveColorLevel({})).toBe(0);
    });
  });

  describe("when FORCE_COLOR is set", () => {
    it.each([
      ["1", 1],
      ["2", 2],
      ["3", 3],
      ["true", 1],
      ["", 1],
    ])("maps %s to level %i", (value, expected) => {
      expect(resolveColorLevel({ FORCE_COLOR: value })).toBe(expected);
    });

    it("clamps out-of-range values", () => {
      expect(resolveColorLevel({ FORCE_COLOR: "9" })).toBe(3);
    });

    it("treats 0 and false as off", () => {
      expect(resolveColorLevel({ FORCE_COLOR: "0" })).toBe(0);
      expect(resolveColorLevel({ FORCE_COLOR: "false" })).toBe(0);
    });
  });

  describe("when NO_COLOR wins", () => {
    it("overrides FORCE_COLOR", () => {
      expect(resolveColorLevel({ NO_COLOR: "1", FORCE_COLOR: "3" })).toBe(0);
    });
  });
});

describe("stdinCarriesData", () => {
  let dir: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-stdin-"));
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe("given a descriptor the daemon cannot be handed", () => {
    it("reports a redirected file as carrying data", () => {
      const file = path.join(dir, "records.json");
      fs.writeFileSync(file, "[]");
      const fd = fs.openSync(file, "r");
      try {
        expect(stdinCarriesData(fd)).toBe(true);
      } finally {
        fs.closeSync(fd);
      }
    });

    it("reports a pipe as carrying data", () => {
      // The shape `cat records.json | langwatch …` actually hands fd 0. node
      // has no mkfifo binding, and O_NONBLOCK is what keeps opening the read
      // end from waiting for a writer that this test is not going to provide.
      const fifo = path.join(dir, "fifo");
      execFileSync("mkfifo", [fifo]);
      const fd = fs.openSync(fifo, fs.constants.O_RDONLY | fs.constants.O_NONBLOCK);
      try {
        expect(stdinCarriesData(fd)).toBe(true);
      } finally {
        fs.closeSync(fd);
      }
    });
  });

  describe("given a descriptor the daemon reproduces exactly", () => {
    it("reports /dev/null as carrying nothing — that IS the daemon's fd 0", () => {
      const fd = fs.openSync("/dev/null", "r");
      try {
        expect(stdinCarriesData(fd)).toBe(false);
      } finally {
        fs.closeSync(fd);
      }
    });

    it("reports a descriptor nothing is open on as carrying nothing rather than throwing", () => {
      // NOT open-then-close: fd numbers are recycled lowest-first, so anything
      // the runner opens between the close and the fstat lands on that same
      // number and the assertion starts measuring an unrelated file — a failure
      // with no relation to the code under test. A number far above what a
      // process this size ever allocates is never handed out, so the fstat can
      // only answer EBADF: exactly what a closed descriptor answers.
      const neverAllocated = 4096;

      // Pin the premise, so a machine that somehow DID have this descriptor
      // open says so plainly instead of failing the real assertion obscurely —
      // and so the case below can never quietly become vacuous.
      expect(() => fs.fstatSync(neverAllocated)).toThrow(
        expect.objectContaining({ code: "EBADF" }),
      );

      expect(stdinCarriesData(neverAllocated)).toBe(false);
    });
  });
});

describe("isAutoSpawnEnabled", () => {
  it("is on by default", () => {
    expect(isAutoSpawnEnabled({})).toBe(true);
  });

  it("is off when LANGWATCH_DAEMON_NO_SPAWN is set", () => {
    expect(isAutoSpawnEnabled({ LANGWATCH_DAEMON_NO_SPAWN: "1" })).toBe(false);
  });
});

describe("isDaemonDisabledByConfig", () => {
  let dir: string;
  let configFile: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-elig-"));
    configFile = path.join(dir, "config.json");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("disables the daemon when the persisted config says daemon off", () => {
    fs.writeFileSync(configFile, JSON.stringify({ daemon: "off" }));

    expect(
      isDaemonDisabledByConfig({ LANGWATCH_CLI_CONFIG: configFile }),
    ).toBe(true);
  });

  it("keeps the daemon enabled when the config says on, or the field is absent", () => {
    fs.writeFileSync(configFile, JSON.stringify({ daemon: "on" }));
    expect(
      isDaemonDisabledByConfig({ LANGWATCH_CLI_CONFIG: configFile }),
    ).toBe(false);

    fs.writeFileSync(configFile, JSON.stringify({ control_plane_url: "x" }));
    expect(
      isDaemonDisabledByConfig({ LANGWATCH_CLI_CONFIG: configFile }),
    ).toBe(false);
  });

  it("keeps the daemon enabled when the config file does not exist", () => {
    expect(
      isDaemonDisabledByConfig({
        LANGWATCH_CLI_CONFIG: path.join(dir, "missing.json"),
      }),
    ).toBe(false);
  });

  it("keeps the daemon enabled when the config file is corrupt — never breaks a command", () => {
    fs.writeFileSync(configFile, "not json {");

    expect(
      isDaemonDisabledByConfig({ LANGWATCH_CLI_CONFIG: configFile }),
    ).toBe(false);
  });
});
