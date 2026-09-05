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
  isPathCandidate,
  isSecretFileName,
  isTextArgument,
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

    /** @scenario "The GitHub CLI sign-in check runs at once" */
    it("runs the GitHub CLI sign-in check and its version at once", () => {
      for (const command of ["gh auth status", "gh --version", "gh version"]) {
        expect(bash(command), command).toEqual({ kind: "run" });
      }
      for (const command of [
        "gh pr create --title x",
        "gh auth login",
        "gh repo clone acme/support",
      ]) {
        expect(bash(command).kind, command).toBe("ask");
      }
    });
  });

  describe("when Langy lists the git worktrees", () => {
    /** @scenario "Listing the git worktrees runs at once" */
    it("runs the list and asks for every other worktree verb", () => {
      const worktrees: [string, PolicyDecision["kind"]][] = [
        ["git worktree list", "run"],
        ["git worktree list --porcelain", "run"],
        ["git worktree add ../copy main", "refuse"],
        ["git worktree remove old", "ask"],
        ["git worktree prune", "ask"],
        ["git worktree move old new", "ask"],
        ["git worktree lock old", "ask"],
      ];
      for (const [command, kind] of worktrees) {
        expect(bash(command).kind, command).toBe(kind);
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
      expect(decision.segments).toEqual([
        { command: "git status", pattern: "git status", readOnly: true },
        { command: "pnpm typecheck", pattern: "pnpm typecheck", readOnly: false },
      ]);
    });

    /** @scenario "A command chain is split into its segments" */
    it("lists every segment of the chain with the pattern it would grant", () => {
      const chain = [
        "git add app.py README.md",
        'git commit -m "feat: add tracing"',
        "git push -u origin HEAD",
        'gh pr create --base main --title "Add tracing"',
      ].join(" && ");
      const decision = bash(chain);
      expect(decision.kind).toBe("ask");
      if (decision.kind !== "ask") return;
      expect(decision.segments).toEqual([
        {
          command: "git add app.py README.md",
          pattern: "git add",
          readOnly: false,
        },
        {
          command: 'git commit -m "feat: add tracing"',
          pattern: "git commit",
          readOnly: false,
        },
        {
          command: "git push -u origin HEAD",
          pattern: "git push",
          readOnly: false,
        },
        {
          command: 'gh pr create --base main --title "Add tracing"',
          pattern: "gh pr",
          readOnly: false,
        },
      ]);
      expect(decision.patterns).toEqual([
        "git add",
        "git commit",
        "git push",
        "gh pr",
      ]);
    });

    /** @scenario "A pattern grant covers exactly the segments the card named" */
    it("runs a later chain whose segments the grants all cover, and asks otherwise", () => {
      const grants = ["git add", "git commit", "git push", "gh pr"];
      expect(
        bash('git add . && git commit -m "wip" && git push', { grants }),
      ).toEqual({ kind: "run" });

      const wider = bash("git add . && git tag -d v1", { grants });
      expect(wider.kind).toBe("ask");
      if (wider.kind !== "ask") return;
      expect(wider.pattern).toBe("git tag");
      expect(wider.segments?.map((segment) => segment.command)).toEqual([
        "git add .",
        "git tag -d v1",
      ]);
    });

    /** @scenario "The reason says what the command changes" */
    it("reads as one sentence about what changes, with no command quoted", () => {
      const table: Array<{ command: string; reason: string }> = [
        {
          command: "pnpm typecheck",
          reason: "This runs the project's own checks.",
        },
        { command: "rm -rf build", reason: "This writes files in the folder." },
        {
          command: "git commit -m done",
          reason: "This changes the git repository.",
        },
        {
          command: "git fetch origin",
          reason: "This reaches the network.",
        },
        {
          command: "uv sync && uv run pytest -s",
          reason:
            "This installs packages and runs the project's own checks.",
        },
        {
          command:
            'git add . && git commit -m "feat: x" && git push -u origin HEAD',
          reason: "This changes the git repository and reaches the network.",
        },
        {
          command: "ls -la > listing.txt",
          reason: "This writes files in the folder.",
        },
        {
          command: "python -m compileall src",
          reason: "This runs the project's own checks.",
        },
        {
          command: "cat $(ls)",
          reason:
            "This runs a command substitution, so what it does is not knowable before it runs.",
        },
      ];
      for (const row of table) {
        const decision = bash(row.command);
        expect(decision.kind, row.command).toBe("ask");
        if (decision.kind !== "ask") continue;
        expect(decision.reason, row.command).toBe(row.reason);
        expect(decision.reason, row.command).not.toContain('"');
      }
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
      if (withExec.kind === "ask") expect(withExec.reason).toContain("writes files");

      const redirected = bash("ls -la > listing.txt");
      expect(redirected.kind).toBe("ask");
      if (redirected.kind === "ask") {
        expect(redirected.reason).toContain("writes files");
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
          expect(decision.segments?.[0]?.readOnly).toBe(false);
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
      expect(grantPatternFor({ tokens: ["pnpm", "typecheck"] })).toBe(
        "pnpm typecheck",
      );
      expect(grantPatternFor({ tokens: ["make"] })).toBe("make *");
      expect(
        grantsAllow({ tokens: ["pnpm", "test"], grants: new Set(["pnpm *"]) }),
      ).toBe(true);
      expect(grantsAllow({ tokens: [], grants: new Set(["pnpm *"]) })).toBe(false);
    });

    /** @scenario "The session grant names the program and its first argument" */
    it("keeps a first argument that is a flag out of a grant over the whole program", () => {
      const patterns: Array<[string[], boolean[] | undefined, string]> = [
        [[".venv/bin/python", "-c", "from app import x"], [false, false, true], ".venv/bin/python -c"],
        [[".venv/bin/python", "-m", "compileall", "-q"], undefined, ".venv/bin/python -m"],
        [["git", "commit", "-m", "done"], undefined, "git commit"],
        [["uv", "run", "pytest"], undefined, "uv run"],
        [["pnpm", "-r", "build"], undefined, "pnpm -r"],
        [["make"], undefined, "make *"],
        [["echo", "hello"], [false, true], "echo *"],
      ];
      for (const [tokens, quoted, expected] of patterns) {
        expect(
          grantPatternFor({
            tokens,
            ...(quoted === undefined ? {} : { quoted }),
          }),
          tokens.join(" "),
        ).toBe(expected);
      }
    });

    /** @scenario "The session grant names the program and its first argument" */
    it("asks again for the same interpreter with another first argument", () => {
      const grants = [".venv/bin/python -c"];
      expect(
        bash(".venv/bin/python -c 'import app'", { grants }).kind,
      ).toBe("run");
      const asked = bash(".venv/bin/python -m http.server", { grants });
      expect(asked.kind).toBe("ask");
      if (asked.kind === "ask") {
        expect(asked.pattern).toBe(".venv/bin/python -m");
      }
    });
  });

  describe("when the same interpreter is written under two names", () => {
    /** @scenario "Interpreter aliases share one grant" */
    it("spends one grant on both spellings", () => {
      const asked = bash("python -m compileall src");
      expect(asked.kind).toBe("ask");
      if (asked.kind === "ask") expect(asked.pattern).toBe("python -m");

      const grants = ["python *"];
      expect(bash("python -m compileall src", { grants })).toEqual({
        kind: "run",
      });
      expect(bash("python3 -m compileall src", { grants })).toEqual({
        kind: "run",
      });
      expect(bash("python3 setup.py check", { grants })).toEqual({
        kind: "run",
      });
    });

    it("folds both spellings of an interpreter into one pattern", () => {
      expect(grantPatternFor({ tokens: ["python3", "-m", "compileall"] })).toBe(
        "python -m",
      );
      expect(grantPatternFor({ tokens: ["nodejs", "server.js"] })).toBe(
        "node server.js",
      );
      expect(grantPatternFor({ tokens: ["pip3", "install", "-r", "reqs.txt"] })).toBe(
        "pip install",
      );
    });

    it("leaves every other command name alone", () => {
      expect(grantPatternFor({ tokens: ["pnpm", "typecheck"] })).toBe(
        "pnpm typecheck",
      );
      expect(
        grantsAllow({ tokens: ["go", "test"], grants: new Set(["python *"]) }),
      ).toBe(false);
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

  describe("when a command prints a quoted string", () => {
    /** @scenario "A quoted string a command prints is not judged a path" */
    it("reads the quoted string as text and keeps checking everything else", () => {
      for (const command of [
        "printf '/etc/passwd\\n'",
        "echo '~/.ssh/config'",
        "git status --porcelain && printf '\\nDEFAULT=/etc/paths\\n' && git diff",
        'printf "/etc/hosts"',
      ]) {
        expect(bash(command).kind, command).not.toBe("refuse");
      }

      for (const command of [
        "cat '/etc/passwd'",
        "printf 'hello' > /etc/passwd",
        "printf 'hello' > '/etc/passwd'",
        "printf '%s\\n' ../other/notes.txt",
      ]) {
        const decision = bash(command);
        expect(decision.kind, command).toBe("refuse");
        if (decision.kind === "refuse") {
          expect(decision.code, command).toBe("path_refused");
        }
      }
    });

    it("names the arguments a printing command reads as text", () => {
      expect(
        isTextArgument({ name: "printf", token: "/etc/passwd", quoted: true }),
      ).toBe(true);
      expect(
        isTextArgument({ name: "echo", token: "~/.ssh/config", quoted: true }),
      ).toBe(true);
      expect(
        isTextArgument({ name: "cat", token: "/etc/passwd", quoted: true }),
      ).toBe(false);
      expect(
        isTextArgument({ name: "printf", token: "/etc/passwd", quoted: false }),
      ).toBe(false);
      // Escape sequences and conversions belong to text, never to a path.
      expect(
        isTextArgument({ name: "grep", token: "/etc/passwd\\n", quoted: true }),
      ).toBe(true);
      expect(
        isTextArgument({ name: "grep", token: "%s/etc/passwd", quoted: true }),
      ).toBe(true);
    });

    it("offers the command name rather than the quoted string as the pattern", () => {
      expect(
        grantPatternFor({
          tokens: ["printf", "\\nLANGWATCH_API_KEY=x\\n", ".env.example"],
          quoted: [false, true, false],
        }),
      ).toBe("printf *");
      expect(
        grantsAllow({
          tokens: ["printf", "\\nLANGWATCH_API_KEY=x\\n", ".env.example"],
          quoted: [false, true, false],
          grants: new Set(["printf *"]),
        }),
      ).toBe(true);
    });

    it("carries the quoted arguments and the redirect targets of a part", () => {
      const parsed = parseCommand("printf '/etc/passwd' > out.txt");
      expect(parsed.parts[0]?.tokens).toEqual([
        "printf",
        "/etc/passwd",
        "out.txt",
      ]);
      expect(parsed.parts[0]?.quoted).toEqual([false, true, false]);
      expect(parsed.parts[0]?.redirectTarget).toEqual([false, false, true]);
    });
  });

  describe("when a git or GitHub CLI command writes its own words", () => {
    /** @scenario "A git or GitHub CLI word is not judged a path" */
    it("reads a subcommand, an option flag and a reference as words", () => {
      const words: [string, boolean][] = [
        ["git remote -v && git symbolic-ref --short HEAD", false],
        ["git rev-parse --abbrev-ref HEAD", false],
        ["git log --oneline -5 origin/main", false],
        ["git diff HEAD~1", false],
        ["gh pr view 12 --json title", false],
        // A separator, a relative path or a home path is still a path.
        ["git add ../other/notes.txt", true],
        ["git apply /etc/patch.diff", true],
        ["git checkout -- ../other/notes.txt", true],
        ["gh pr create --body-file ~/../../etc/passwd", true],
        // The directory flags keep their argument whatever it looks like.
        ["git --git-dir=/etc status", true],
        ["git --work-tree /etc status", true],
      ];
      for (const [command, refused] of words) {
        expect(bash(command).kind === "refuse", command).toBe(refused);
      }
    });

    it("names the tokens a command's own vocabulary covers", () => {
      expect(isPathCandidate({ name: "git", token: "HEAD" })).toBe(false);
      expect(isPathCandidate({ name: "git", token: "symbolic-ref" })).toBe(
        false,
      );
      expect(isPathCandidate({ name: "git", token: "--short" })).toBe(false);
      expect(isPathCandidate({ name: "git", token: "src/app.py" })).toBe(true);
      expect(isPathCandidate({ name: "git", token: "../other" })).toBe(true);
      expect(isPathCandidate({ name: "git", token: "~/notes" })).toBe(true);
      // After the end-of-options marker every word is a path.
      expect(
        isPathCandidate({
          name: "git",
          token: "HEAD",
          afterEndOfOptions: true,
        }),
      ).toBe(true);
      // Every other command keeps the wide net: a bare name can be a symlink.
      expect(isPathCandidate({ name: "cat", token: "outside-link" })).toBe(
        true,
      );
    });

    it("still refuses a bare name that is a symlink out of the folder", () => {
      const decision = bash("cat outside-link");
      expect(decision.kind).toBe("refuse");
    });
  });

  describe("when a command is refused for naming a path outside the folder", () => {
    /** @scenario "A refusal names the argument it judged a path" */
    it("names the argument, where it points and the folder that is allowed", () => {
      const decision = bash("cat /etc/passwd");
      expect(decision.kind).toBe("refuse");
      if (decision.kind !== "refuse") return;
      expect(decision.message).toBe(
        `Only paths inside ${ROOT} are allowed. The argument "/etc/passwd" was read as a path, and it points at /etc/passwd, which is outside the folder.`,
      );
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

    /** @scenario "A committed example environment file is not a secret" */
    it("runs a read of a committed example environment file at once", () => {
      for (const name of [
        ".env.example",
        ".env.sample",
        ".env.template",
        ".env.dist",
        ".env.EXAMPLE",
      ]) {
        expect(isSecretFileName(name), name).toBe(false);
        expect(at({ tool: "local_read", params: { path: name } }), name).toEqual(
          { kind: "run" },
        );
      }
      expect(isSecretFileName(".env.example.local")).toBe(true);
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

describe("when a command wraps another one in env", () => {
  /**
   * The operand grammar of every form of `env` this policy understands. A
   * form that is not in this table asks, whatever it looks like.
   */
  const forms: Array<[string, PolicyDecision["kind"]]> = [
    ["env", "ask"],
    ["env -0", "ask"],
    ["printenv", "ask"],
    ["printenv PATH", "ask"],
    ["env ls -la", "run"],
    ["env -i ls", "run"],
    ["env -u NODE_ENV ls", "run"],
    ["env NODE_ENV=test ls", "run"],
    ["env NODE_ENV=test rm -rf build", "ask"],
    ["env touch marker", "ask"],
    ["env --split-string='touch marker'", "ask"],
    ["env -S 'touch marker'", "ask"],
    ["env --default-signal=INT ls", "ask"],
    ["env --ignore-signal=INT ls", "ask"],
    ["env --block-signal=INT ls", "ask"],
    // A directory outside the folder is refused before the grammar is read.
    ["env -C /tmp ls", "refuse"],
    ["env --chdir=/tmp ls", "refuse"],
    ["env -C . ls", "ask"],
  ];

  /** @scenario "An env option that can carry a program asks" */
  it("runs only the forms that prepare the environment of a read-only command", () => {
    for (const [command, kind] of forms) {
      expect(bash(command).kind, command).toBe(kind);
    }
  });

  /** @scenario "An env option that can carry a program asks" */
  it("says the environment may hold secrets when it would be printed", () => {
    const decision = bash("env");
    expect(decision.kind).toBe("ask");
    if (decision.kind === "ask") {
      expect(decision.reason).toContain("prints the environment");
    }
  });
});

describe("when an allowed command carries an operand that writes", () => {
  /**
   * The operand grammar of the read-only commands. A subcommand or an option
   * that writes takes the command out of the read-only class, whatever the
   * name in front of it is.
   */
  const grammar: Array<[string, PolicyDecision["kind"]]> = [
    ["git branch", "run"],
    ["git branch -a", "run"],
    ["git branch --list", "run"],
    ["git branch new-branch", "ask"],
    ["git branch -d old-branch", "ask"],
    ["git tag", "run"],
    ["git tag v1.2.0", "ask"],
    ["git remote", "run"],
    ["git remote -v", "run"],
    ["git remote get-url origin", "run"],
    ["git remote show origin", "ask"],
    ["git remote add upstream https://example.test/acme.git", "ask"],
    ["git worktree list", "run"],
    ["git worktree add ../copy main", "refuse"],
    ["git status --porcelain", "run"],
    ["git log -8 --oneline", "run"],
    ["git rev-parse --abbrev-ref HEAD", "run"],
    ["sort package.json", "run"],
    ["sort -o sorted.txt package.json", "ask"],
    ["sort --output=sorted.txt package.json", "ask"],
    ["uniq package.json", "run"],
    ["uniq package.json copy.json", "ask"],
    ["tree -L 2", "run"],
    ["tree -o listing.txt", "ask"],
    ["date", "run"],
    ["date -s 12:00", "ask"],
    ["wc -l package.json", "run"],
    ["head -n 3 package.json", "run"],
  ];

  /** @scenario "An allowed command with an operand that writes asks" */
  it("judges the operands and not only the command name", () => {
    for (const [command, kind] of grammar) {
      expect(bash(command).kind, command).toBe(kind);
    }
  });
});

describe("when a shell command reads a file that may hold secrets", () => {
  /** @scenario "A shell command that reads a file which may hold secrets asks" */
  it("asks for the same file a read of it asks for", () => {
    const reads: Array<[string, PolicyDecision["kind"]]> = [
      ["cat .env", "ask"],
      ["head -n 3 .env.local", "ask"],
      ["grep KEY .env", "ask"],
      ["grep KEY .env*", "ask"],
      ["cat *.pem", "ask"],
      ["cat config/credentials.json", "ask"],
      ["cat .npmrc", "ask"],
      ["cat .env.example", "run"],
      ["cat package.json", "run"],
      ["ls -la", "run"],
      ["cat src/main.py", "run"],
    ];
    for (const [command, kind] of reads) {
      expect(bash(command).kind, command).toBe(kind);
    }

    // The file tool and the shell answer the same way for the same file.
    expect(at({ tool: "local_read", params: { path: ".env" } }).kind).toBe("ask");
    const shell = bash("cat .env");
    expect(shell.kind).toBe("ask");
    if (shell.kind === "ask") {
      expect(shell.reason).toContain(".env may hold secrets");
      expect(shell.segments?.[0]?.readOnly).toBe(false);
    }
  });
});

describe("when Langy lists the branches or the tags of the repository", () => {
  /**
   * The listing forms of the subcommands that also write. The skill asks
   * Langy to list the branches of a prefix before it makes one, so these run
   * with no card, and their operands are references rather than file names.
   */
  const listings: Array<[string, PolicyDecision["kind"]]> = [
    ["git branch --list 'langy/*'", "run"],
    ["git branch -l 'langy/*'", "run"],
    ["git branch --show-current", "run"],
    ["git branch --contains HEAD", "run"],
    ["git branch --merged main", "run"],
    ["git branch --no-merged main", "run"],
    ["git branch --points-at HEAD", "run"],
    ["git branch --sort=-committerdate", "run"],
    ["git tag -l 'v*'", "run"],
    ["git tag --list 'v*'", "run"],
    ["git branch langy/add-tracing", "ask"],
    ["git tag v1.2.0", "ask"],
    ["git branch -d langy/old", "ask"],
  ];

  /** @scenario "A listing form of a git subcommand that also writes runs" */
  it("runs the listing forms and asks for the ones that write", () => {
    for (const [command, kind] of listings) {
      expect(bash(command).kind, command).toBe(kind);
    }
  });

  /** @scenario "A listing form of a git subcommand that also writes runs" */
  it("reads a reference pattern as a reference, not as a wildcard over the folder", () => {
    // The glob rule holds for every other command, and a git or GitHub word
    // is judged by its exact name only.
    expect(bash("git branch --list 'langy/*'").kind).toBe("run");
    expect(bash("gh pr list --search 'secret*'").kind).toBe("ask");
    expect(bash("cat *.pem").kind).toBe("ask");
  });
});

describe("when a write option is attached to its value or to another flag", () => {
  /** @scenario "An allowed command with an operand that writes asks" */
  it("reads the option whichever way it is written", () => {
    const spellings: Array<[string, PolicyDecision["kind"]]> = [
      ["sort -o out.txt package.json", "ask"],
      ["sort -oout.txt package.json", "ask"],
      ["sort -ro out.txt package.json", "ask"],
      ["sort --output=out.txt package.json", "ask"],
      ["sort --output out.txt package.json", "ask"],
      ["sort -r package.json", "run"],
      ["sort -u package.json", "run"],
      ["tree -o listing.txt", "ask"],
      ["tree -L 2", "run"],
      ["date -s 12:00", "ask"],
      ["date -u", "run"],
    ];
    for (const [command, kind] of spellings) {
      expect(bash(command).kind, command).toBe(kind);
    }
  });
});

describe("when a file may hold secrets", () => {
  /**
   * The names and the paths that ask. Every one of them was read with no
   * card before, through the file tool or through a shell command.
   */
  const secrets: readonly string[] = [
    ".env",
    ".env.local",
    ".envrc",
    ".git-credentials",
    ".pgpass",
    ".my.cnf",
    ".htpasswd",
    ".netrc",
    ".npmrc",
    "credentials.json",
    "keystore.p12",
    "signing.pfx",
    "release.jks",
    "app.keystore",
    "github.token",
    "token",
    "tokens",
    ".secrets",
    "secrets.yml",
    "config/secrets.yml",
    "secret.json",
    "SECRETS.md",
    ".git/config",
    ".docker/config.json",
    ".ssh/known_hosts",
    ".aws/config",
    "id_rsa",
    "server.key",
    "key.pem",
  ];

  /** @scenario "A shell command that reads a file which may hold secrets asks" */
  it("reads what a printing command is given as text rather than as a file", () => {
    expect(bash("echo secret-output")).toEqual({ kind: "run" });
    expect(bash("printf 'the secret is %s' x")).toEqual({ kind: "run" });
    expect(bash("echo x > .env").kind).toBe("ask");
  });

  const ordinary: readonly string[] = [
    ".env.example",
    ".env.sample",
    "package.json",
    "app/main.py",
    "README.md",
    ".github/workflows/ci.yml",
    "config/database.yml",
  ];

  /** @scenario "A shell command that reads a file which may hold secrets asks" */
  it("asks for the same file through the file tool and through the shell", () => {
    for (const target of secrets) {
      expect(at({ tool: "local_read", params: { path: target } }).kind, target).toBe(
        "ask",
      );
      expect(bash(`cat ${target}`).kind, `cat ${target}`).toBe("ask");
    }
  });

  /** @scenario "A shell command that reads a file which may hold secrets asks" */
  it("runs the files that carry placeholders or code", () => {
    for (const target of ordinary) {
      expect(at({ tool: "local_read", params: { path: target } }).kind, target).toBe(
        "run",
      );
      expect(bash(`cat ${target}`).kind, `cat ${target}`).toBe("run");
    }
  });
});
