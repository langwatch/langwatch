/**
 * @vitest-environment node
 *
 * The recogniser that replaced the prose sentinel. It decides, from the tool
 * stream the agent actually produces, whether it is reaching for GitHub — so the
 * control plane can stop the turn and show the Connect card WITHOUT asking the
 * model to announce anything.
 *
 * Two ways to get this wrong, and they are not symmetric:
 *   - A false NEGATIVE (missing a `gh`) means the turn dies on a confusing auth
 *     error instead of showing the Connect card. Bad.
 *   - A false POSITIVE (stopping a turn that never needed GitHub) means a
 *     perfectly good local turn is killed and the user is told to connect an
 *     account they don't need. Worse.
 * The local-git cases below are therefore the important half of this file.
 */
import { describe, expect, it } from "vitest";
import { githubProgressFromToolParts, needsGithubAuth } from "../githubCommand";

describe("needsGithubAuth", () => {
  describe("given the GitHub CLI", () => {
    it("always needs the token — every gh invocation authenticates", () => {
      for (const command of [
        "gh repo clone acme/foo -- --depth 1",
        "gh pr create --title x --body y --base main",
        "gh repo view --json defaultBranchRef",
        "gh api user --jq .id",
      ]) {
        expect(needsGithubAuth(command), command).toBe(true);
      }
    });
  });

  describe("given a git command that talks to the remote", () => {
    it("needs the token — it authenticates through the gh credential helper", () => {
      for (const command of [
        "git clone https://github.com/acme/foo",
        "git push -u origin HEAD",
        "git fetch origin",
        "git pull --rebase",
        "git ls-remote --heads origin",
      ]) {
        expect(needsGithubAuth(command), command).toBe(true);
      }
    });

    it("sees past git's global flags to the subcommand", () => {
      expect(needsGithubAuth('git -C "$HOME/work/foo" push')).toBe(true);
      expect(needsGithubAuth("git -c core.pager=cat fetch origin")).toBe(true);
    });
  });

  describe("given git doing purely local work", () => {
    it("does NOT need the token — a local turn must never be stopped", () => {
      // The false-positive guard. A turn that edits and commits locally is a
      // perfectly good turn; killing it to demand a GitHub connection the user
      // does not need would be a regression on every non-GitHub request.
      for (const command of [
        "git checkout -b langy/fix-retry",
        "git add -A",
        'git commit -m "fix the retry bug"',
        "git status",
        "git diff --staged",
        'git config --global user.name "octocat"',
      ]) {
        expect(needsGithubAuth(command), command).toBe(false);
      }
    });
  });

  describe("given ordinary shell work", () => {
    it("does not need the token", () => {
      for (const command of [
        'mkdir -p "$HOME/work" && cd "$HOME/work"',
        "ls -la",
        "cat README.md",
        "langwatch trace search --format json",
        // The word "github" in a path or a URL is not a GitHub CALL.
        "cat /home/langy/github-notes.md",
        "echo 'see github.com for docs'",
      ]) {
        expect(needsGithubAuth(command), command).toBe(false);
      }
    });
  });

  describe("when the GitHub call hides inside a chained command", () => {
    // The skill's own steps chain commands, so a recogniser that only reads the
    // first word would sail straight past the push.
    it("finds it after &&", () => {
      expect(needsGithubAuth("git add -A && git push -u origin HEAD")).toBe(
        true,
      );
    });

    it("finds it after a semicolon, a pipe, and a newline", () => {
      expect(needsGithubAuth("cd repo; gh pr create --fill")).toBe(true);
      expect(needsGithubAuth("gh pr list | head -5")).toBe(true);
      expect(needsGithubAuth("cd repo\ngit push")).toBe(true);
    });

    it("finds it inside a command substitution", () => {
      expect(needsGithubAuth("GH_USER_ID=$(gh api user --jq .id)")).toBe(true);
    });

    it("sees past an inline env assignment", () => {
      expect(needsGithubAuth("GIT_TERMINAL_PROMPT=0 git push")).toBe(true);
    });
  });

  describe("when the command is empty or junk", () => {
    it("does not need the token", () => {
      expect(needsGithubAuth("")).toBe(false);
      expect(needsGithubAuth("   ")).toBe(false);
      expect(needsGithubAuth("&&")).toBe(false);
    });
  });
});

/**
 * The steps card's own recogniser. An agent working in a developer's own folder
 * runs the whole tail of the flow as one call, so the card is only correct if a
 * chained command contributes every step it ran.
 *
 * @see specs/langy/langy-github-prs.feature
 */
describe("githubProgressFromToolParts", () => {
  const chain =
    'git add app/agent.py README.md && git commit -m "feat: add LangWatch tracing" && git push -u origin HEAD && gh pr create --base main --title "Add tracing"';

  describe("given one settled command that commits, pushes and opens the PR", () => {
    /** @scenario "One command that commits, pushes and opens the PR ticks all three steps" */
    it("reaches the committed, pushed and opened steps", () => {
      const events = githubProgressFromToolParts([
        {
          type: "tool-local_bash",
          input: { command: chain },
          state: "output-available",
        },
      ]);

      expect(events.map((event) => event.stage)).toEqual([
        "committed",
        "pushed",
        "opened",
      ]);
      expect(events[0]?.detail).toBe("feat: add LangWatch tracing");
    });
  });

  describe("when that command failed", () => {
    /** @scenario "A step whose command errored is not reached" */
    it("reaches no step at all", () => {
      expect(
        githubProgressFromToolParts([
          {
            type: "tool-local_bash",
            input: { command: chain },
            state: "output-error",
          },
        ]),
      ).toEqual([]);
    });
  });

  describe("given the chain printed the pull request URL", () => {
    /** @scenario "The pull request URL printed by the command reaches the opened step" */
    it("carries the URL on the opened step", () => {
      const events = githubProgressFromToolParts([
        {
          type: "tool-local_bash",
          input: { command: chain },
          state: "output-available",
          output: [
            "exit code: 0",
            "",
            "stdout:",
            "branch 'langy/add-tracing' set up to track 'origin/langy/add-tracing'.",
            "Warning: 1 uncommitted change",
            "https://github.com/acme/support-agent/pull/12",
          ].join("\n"),
        },
      ]);

      expect(events.find((event) => event.stage === "opened")?.url).toBe(
        "https://github.com/acme/support-agent/pull/12",
      );
      expect(
        events.find((event) => event.stage === "pushed")?.url,
      ).toBeUndefined();
    });
  });

  describe("given a command that printed no pull request URL", () => {
    /** @scenario "A command that opened no pull request leaves the opened step without a URL" */
    it("leaves the opened step without a URL", () => {
      const events = githubProgressFromToolParts([
        {
          type: "tool-local_bash",
          input: { command: 'gh pr create --title "Add tracing" --body b' },
          state: "output-available",
          output: "exit code: 0\n\nstdout:\n",
        },
      ]);

      expect(events).toEqual([{ stage: "opened" }]);
    });
  });

  describe("when the chain is still running", () => {
    it("shows only the first step as under way", () => {
      const events = githubProgressFromToolParts([
        {
          type: "tool-bash",
          input: { command: "git clone https://github.com/acme/foo && cd foo" },
          state: "input-available",
        },
      ]);

      expect(events).toEqual([{ stage: "cloning", detail: "acme/foo" }]);
    });
  });
});
