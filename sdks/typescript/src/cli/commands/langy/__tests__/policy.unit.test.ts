/**
 * The permission rules of specs/langy/langy-local-permissions.feature.
 *
 * The table drives one decision per line: the folder is `/work/acme`, the
 * home directory is `/home/dev`, and `realpath` is a fixture map so no test
 * touches the disk. `fs-ops` covers a real symlink.
 */

import { describe, expect, it } from "vitest";
import type { LocalToolCall } from "../../../../agent/local-control-protocol";
import {
  decide,
  grantPatternFor,
  grantsAllow,
  isSecretFileName,
  looksLikeAPath,
  parseCommand,
  type PolicyDecision,
} from "../policy";

const ROOT = "/work/acme";
const HOME = "/home/dev";

/** `/work/acme/outside-link` is a symlink to `/work/other`. */
const realpath = (target: string): string =>
  target === `${ROOT}/outside-link`
    ? "/work/other"
    : target.startsWith(`${ROOT}/outside-link/`)
      ? target.replace(`${ROOT}/outside-link`, "/work/other")
      : target;

const at = (
  call: LocalToolCall,
  options: { grants?: string[]; skipPermissions?: boolean } = {},
): PolicyDecision =>
  decide({
    call,
    root: ROOT,
    grants: new Set(options.grants ?? []),
    skipPermissions: options.skipPermissions ?? false,
    realpath,
    homedir: HOME,
  });

const bash = (
  command: string,
  options: { grants?: string[]; skipPermissions?: boolean } = {},
): PolicyDecision => at({ tool: "local_bash", params: { command } }, options);

describe("given a folder shared with a Langy conversation", () => {
  describe("when Langy reads, lists, finds or searches inside the folder", () => {
    /** @scenario "Reading, listing and searching never ask" */
    it("runs every read-only tool at once", () => {
      const calls: LocalToolCall[] = [
        { tool: "local_read", params: { path: "src/app.py" } },
        { tool: "local_ls", params: { path: "src" } },
        { tool: "local_ls", params: {} },
        { tool: "local_find", params: { pattern: "**/*.py" } },
        { tool: "local_grep", params: { pattern: "langwatch", path: "src" } },
      ];
      for (const call of calls) {
        expect(at(call), call.tool).toEqual({ kind: "run" });
      }
    });
  });

  describe("when Langy runs a command from the read-only set", () => {
    /** @scenario "A read-only shell command runs at once" */
    it("runs it at once", () => {
      const commands = [
        "ls -la src",
        "cat package.json",
        "head -n 20 README.md",
        "git status",
        "git log --oneline -20",
        "git diff HEAD",
        "git rev-parse --abbrev-ref HEAD",
        "git remote",
        "node -v",
        "python3 --version",
        "pnpm --version",
        "go version",
        "wc -l src/app.py",
        "pwd",
        "which node",
        "git status && git diff",
        "cat package.json | wc -l",
      ];
      for (const command of commands) {
        expect(bash(command), command).toEqual({ kind: "run" });
      }
    });
  });

  describe("when Langy writes or edits a file inside the folder", () => {
    /** @scenario "Editing a file inside the folder runs at once" */
    it("applies the change with no card", () => {
      expect(
        at({ tool: "local_write", params: { path: "src/new.py", content: "x" } }),
      ).toEqual({ kind: "run" });
      expect(
        at({
          tool: "local_edit",
          params: { path: "src/app.py", edits: [{ oldText: "a", newText: "b" }] },
        }),
      ).toEqual({ kind: "run" });
    });
  });

  describe("when a read-only command is chained with one that is not", () => {
    /** @scenario "A compound command is judged by its strictest part" */
    it("asks for the whole command and names the offending part", () => {
      const decision = bash("git status && pnpm typecheck");
      expect(decision.kind).toBe("ask");
      if (decision.kind !== "ask") return;
      expect(decision.summary).toBe("git status && pnpm typecheck");
      expect(decision.pattern).toBe("pnpm typecheck");
      expect(decision.reason).toContain("pnpm typecheck");
    });

    it("judges every separator the shell has", () => {
      for (const command of [
        "ls; rm -rf build",
        "ls || rm -rf build",
        "ls | xargs rm",
        "ls\nrm -rf build",
      ]) {
        expect(bash(command).kind, command).toBe("ask");
      }
    });
  });

  describe("when a read-only command carries a write flag or a redirect", () => {
    /** @scenario "A read-only command with a write flag or a redirect asks" */
    it("asks", () => {
      const withExec = bash("find . -name '*.py' -exec rm {} ;");
      expect(withExec.kind).toBe("ask");
      if (withExec.kind === "ask") expect(withExec.reason).toContain("-exec");

      const redirected = bash("ls -la > listing.txt");
      expect(redirected.kind).toBe("ask");
      if (redirected.kind === "ask") {
        expect(redirected.reason).toContain("redirects");
      }

      for (const command of [
        "cat package.json >> log.txt",
        "wc -l < package.json",
        "ls 2> errors.txt",
        "find . -delete",
      ]) {
        expect(bash(command).kind, command).toBe("ask");
      }
    });

    it("asks for a command substitution because what it expands to is unknown", () => {
      for (const command of [
        "cat $(ls)",
        "cat `ls`",
        "diff <(cat a) <(cat b)",
        'echo "value: $(whoami)"',
      ]) {
        expect(bash(command).kind, command).toBe("ask");
      }
    });

    it("keeps a quoted operator inside its own command", () => {
      expect(bash('echo "build && deploy"')).toEqual({ kind: "run" });
      expect(bash("echo 'rm -rf /'")).toEqual({ kind: "run" });
    });
  });

  describe("when a read-only command is named by its path", () => {
    /** @scenario "Only a bare command name can be read-only" */
    it("asks", () => {
      for (const command of ["./sed -i s/a/b/ x", "/usr/bin/ls -la", "/bin/cat x"]) {
        const decision = bash(command);
        expect(decision.kind, command).toBe("ask");
        if (decision.kind === "ask") {
          expect(decision.reason).toContain("names its program by path");
        }
      }
    });

    it("asks when the command is prefixed with environment variables", () => {
      expect(bash("FOO=1 ls").kind).toBe("ask");
    });
  });

  describe("when the user allowed a pattern for this session", () => {
    /** @scenario "A grant follows the command name and its first argument" */
    it("runs a command with the same name and first argument", () => {
      expect(bash("git push origin feature-x", { grants: ["git push"] })).toEqual({
        kind: "run",
      });
      expect(bash("git push", { grants: ["git push"] })).toEqual({ kind: "run" });
    });

    it("still asks for the same command with another first argument", () => {
      const decision = bash("git commit -m done", { grants: ["git push"] });
      expect(decision.kind).toBe("ask");
      if (decision.kind === "ask") expect(decision.pattern).toBe("git commit");
    });

    it("runs any command of a name granted with a star", () => {
      expect(bash("pnpm typecheck", { grants: ["pnpm *"] })).toEqual({ kind: "run" });
      expect(bash("pnpm install --frozen-lockfile", { grants: ["pnpm *"] })).toEqual({
        kind: "run",
      });
    });

    it("offers the name and its first argument as the pattern", () => {
      expect(grantPatternFor(["pnpm", "typecheck"])).toBe("pnpm typecheck");
      expect(grantPatternFor(["pnpm", "-r", "build"])).toBe("pnpm build");
      expect(grantPatternFor(["make"])).toBe("make *");
      expect(
        grantsAllow({ tokens: ["pnpm", "test"], grants: new Set(["pnpm *"]) }),
      ).toBe(true);
      expect(grantsAllow({ tokens: [], grants: new Set(["pnpm *"]) })).toBe(false);
    });
  });

  describe("when a path points outside the folder", () => {
    /** @scenario "A path outside the folder is refused" */
    it("refuses every escape shape and names the folder that is allowed", () => {
      const calls: LocalToolCall[] = [
        { tool: "local_read", params: { path: "../other/secrets.txt" } },
        { tool: "local_read", params: { path: "/etc/passwd" } },
        { tool: "local_read", params: { path: "~/.ssh/config" } },
        { tool: "local_read", params: { path: "outside-link/notes.txt" } },
        { tool: "local_ls", params: { path: ".." } },
        { tool: "local_edit", params: { path: "/etc/hosts", edits: [{ oldText: "a", newText: "b" }] } },
        { tool: "local_write", params: { path: "../escape.txt", content: "x" } },
        { tool: "local_grep", params: { pattern: "key", path: "/etc" } },
      ];
      for (const call of calls) {
        const decision = at(call);
        expect(decision.kind, JSON.stringify(call)).toBe("refuse");
        if (decision.kind !== "refuse") continue;
        expect(decision.code).toBe("path_refused");
        expect(decision.message).toContain(ROOT);
      }
    });

    it("refuses a command argument that leaves the folder", () => {
      for (const command of [
        "cat /etc/passwd",
        "cat ../other/notes.txt",
        "cat ~/.netrc",
        "ls outside-link",
      ]) {
        const decision = bash(command);
        expect(decision.kind, command).toBe("refuse");
        if (decision.kind === "refuse") expect(decision.code).toBe("path_refused");
      }
    });

    it("allows a home path that lands inside the folder", () => {
      const decision = decide({
        call: { tool: "local_read", params: { path: "~/acme/src/app.py" } },
        root: "/home/dev/acme",
        grants: new Set(),
        skipPermissions: false,
        realpath: (value) => value,
        homedir: HOME,
      });
      expect(decision).toEqual({ kind: "run" });
    });
  });

  describe("when a command changes into a directory outside the folder", () => {
    /** @scenario "A command that changes directory outside the folder is refused" */
    it("refuses the change and the directory flags", () => {
      for (const command of [
        "cd /tmp && ls",
        "cd ../other && git status",
        "git -C /etc status",
        "git --git-dir=/other/.git log",
        "git --work-tree /other status",
      ]) {
        const decision = bash(command);
        expect(decision.kind, command).toBe("refuse");
        if (decision.kind !== "refuse") continue;
        expect(decision.code).toBe("path_refused");
        expect(decision.message).toContain(ROOT);
      }
    });

    it("asks rather than refuses when the directory is inside the folder", () => {
      const decision = bash("cd packages/app && ls");
      expect(decision.kind).toBe("ask");
    });
  });

  describe("when a command asks for administrator rights", () => {
    /** @scenario "Privilege escalation is refused" */
    it("refuses sudo, su and doas anywhere in the command", () => {
      for (const command of [
        "sudo rm -rf /",
        "ls && sudo systemctl restart nginx",
        "su - root",
        "doas pkg install",
        "echo hi | sudo tee /etc/hosts",
      ]) {
        const decision = bash(command);
        expect(decision.kind, command).toBe("refuse");
        if (decision.kind !== "refuse") continue;
        expect(decision.code).toBe("command_refused");
        expect(decision.message).toContain("without administrator rights");
      }
    });
  });

  describe("when the file may hold secrets", () => {
    /** @scenario "A secret file asks even for a read" */
    it("asks even for a read and says why", () => {
      const names = [
        ".env",
        ".env.local",
        "server.pem",
        "tls.key",
        "id_rsa",
        "id_ed25519.pub",
        ".netrc",
        ".npmrc",
        ".pypirc",
        "credentials.json",
      ];
      for (const name of names) {
        const decision = at({ tool: "local_read", params: { path: name } });
        expect(decision.kind, name).toBe("ask");
        if (decision.kind !== "ask") continue;
        expect(decision.reason).toContain("may hold secrets");
        expect(decision.summary).toBe(`read ${name}`);
      }
      expect(isSecretFileName("app.py")).toBe(false);
      expect(isSecretFileName(".env")).toBe(true);
    });

    it("asks for a write to a secret file too", () => {
      const decision = at({
        tool: "local_write",
        params: { path: "config/.env.production", content: "x" },
      });
      expect(decision.kind).toBe("ask");
    });
  });

  describe("when permission checks are off for this session", () => {
    /** @scenario "Skipping never lifts the folder boundary or the privilege rule" */
    it("runs what would ask and still refuses what is out of bounds", () => {
      const skipPermissions = true;
      expect(bash("pnpm typecheck", { skipPermissions })).toEqual({ kind: "run" });
      expect(
        at({ tool: "local_read", params: { path: ".env" } }, { skipPermissions }),
      ).toEqual({ kind: "run" });

      const outside = bash("cat /etc/passwd", { skipPermissions });
      expect(outside.kind).toBe("refuse");
      const escalated = bash("sudo rm -rf /", { skipPermissions });
      expect(escalated.kind).toBe("refuse");
      const outsideRead = at(
        { tool: "local_read", params: { path: "../other/x" } },
        { skipPermissions },
      );
      expect(outsideRead.kind).toBe("refuse");
    });
  });
});

describe("the command reader", () => {
  describe("when a command carries quotes and operators", () => {
    it("splits on the operators that are not quoted", () => {
      const parsed = parseCommand("git status && echo 'a && b' | wc -l");
      expect(parsed.parts.map((part) => part.tokens)).toEqual([
        ["git", "status"],
        ["echo", "a && b"],
        ["wc", "-l"],
      ]);
      expect(parsed.hasSubstitution).toBe(false);
    });

    it("reports a substitution wherever it appears", () => {
      expect(parseCommand("echo $(date)").hasSubstitution).toBe(true);
      expect(parseCommand("echo `date`").hasSubstitution).toBe(true);
      expect(parseCommand('echo "$(date)"').hasSubstitution).toBe(true);
      expect(parseCommand("echo '$(date)'").hasSubstitution).toBe(false);
    });

    it("reports a redirect on the part that carries it", () => {
      const parsed = parseCommand("ls > out.txt");
      expect(parsed.parts[0]?.hasRedirect).toBe(true);
      expect(parseCommand("ls").parts[0]?.hasRedirect).toBe(false);
    });
  });

  describe("when a token is checked against the folder boundary", () => {
    it("recognises the shapes a path is written in", () => {
      expect(looksLikeAPath("../other")).toBe(true);
      expect(looksLikeAPath("/etc/passwd")).toBe(true);
      expect(looksLikeAPath("~/notes")).toBe(true);
      expect(looksLikeAPath("./run.sh")).toBe(true);
      expect(looksLikeAPath("src/app.py")).toBe(true);
      // A bare word is a candidate too: it may be a symlink out of the folder.
      expect(looksLikeAPath("status")).toBe(true);
      expect(looksLikeAPath("--oneline")).toBe(false);
      expect(looksLikeAPath("https://langwatch.ai/x")).toBe(false);
      expect(looksLikeAPath("FOO=1")).toBe(false);
    });
  });
});
