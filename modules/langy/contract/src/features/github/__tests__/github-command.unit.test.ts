import { describe, expect, it } from "vitest";

import { githubProgressFromToolParts, needsGithubAuth } from "../github-command.ts";

describe("needsGithubAuth", () => {
  it("recognises every GitHub CLI invocation", () => {
    for (const command of [
      "gh repo clone acme/foo -- --depth 1",
      "gh pr create --title x --body y --base main",
      "gh repo view --json defaultBranchRef",
      "gh api user --jq .id",
    ]) {
      expect(needsGithubAuth(command)).toBe(true);
    }
  });

  it("recognises remote git commands, including global flags", () => {
    for (const command of [
      "git clone https://github.com/acme/foo",
      "git push -u origin HEAD",
      "git fetch origin",
      "git pull --rebase",
      "git ls-remote --heads origin",
      'git -C "$HOME/work/foo" push',
      "git -c core.pager=cat fetch origin",
    ]) {
      expect(needsGithubAuth(command)).toBe(true);
    }
  });

  it("does not stop local git or ordinary shell work", () => {
    for (const command of [
      "git checkout -b langy/fix-retry",
      "git add -A",
      'git commit -m "fix the retry bug"',
      "git status",
      "git diff --staged",
      'git config --global user.name "octocat"',
      'mkdir -p "$HOME/work" && cd "$HOME/work"',
      "ls -la",
      "cat README.md",
      "langwatch trace search --format json",
      "cat /home/langy/github-notes.md",
      "echo 'see github.com for docs'",
    ]) {
      expect(needsGithubAuth(command)).toBe(false);
    }
  });

  it("recognises chained calls without matching empty shell input", () => {
    for (const command of [
      "git add -A && git push -u origin HEAD",
      "cd repo; gh pr create --fill",
      "gh pr list | head -5",
      "cd repo\ngit push",
      "GH_USER_ID=$(gh api user --jq .id)",
      "GIT_TERMINAL_PROMPT=0 git push",
    ]) {
      expect(needsGithubAuth(command)).toBe(true);
    }

    for (const command of ["", "   ", "&&"]) {
      expect(needsGithubAuth(command)).toBe(false);
    }
  });
});

describe("githubProgressFromToolParts", () => {
  const part = (command: string, state: string, output?: unknown) => ({
    type: "tool-bash",
    input: { command },
    state,
    output,
  });

  describe("given one command that commits, pushes and opens the pull request", () => {
    /** @scenario "One command that commits, pushes and opens the PR ticks all three steps" */
    it("reaches the committed, pushed and opened steps", () => {
      const events = githubProgressFromToolParts([
        part(
          "git add . && git commit -m x && git push -u origin HEAD && gh pr create --base main",
          "output-available",
          "https://github.com/acme/service-x/pull/12",
        ),
      ]);

      expect(events.map((event) => event.stage)).toEqual(["committed", "pushed", "opened"]);
    });
  });

  describe("given a command that commits and pushes but failed", () => {
    /** @scenario "A step whose command errored is not reached" */
    it("reaches no step of that command", () => {
      const events = githubProgressFromToolParts([
        part("git add . && git commit -m x && git push -u origin HEAD", "output-error"),
      ]);

      expect(events).toEqual([]);
    });
  });

  describe("given a command that printed a warning line and then the pull request URL", () => {
    /** @scenario "The pull request URL printed by the command reaches the opened step" */
    it("carries the URL on the opened step", () => {
      const events = githubProgressFromToolParts([
        part(
          "git add -A && git commit -m x && git push -u origin HEAD && gh pr create --title t --body b",
          "output-available",
          "Warning: 1 uncommitted change\nhttps://github.com/acme/service-x/pull/12\n",
        ),
      ]);

      expect(events.find((event) => event.stage === "opened")?.url).toBe(
        "https://github.com/acme/service-x/pull/12",
      );
    });
  });

  describe("given a pull request command that printed no pull request URL", () => {
    /** @scenario "A command that opened no pull request leaves the opened step without a URL" */
    it("leaves the opened step without a URL", () => {
      const events = githubProgressFromToolParts([
        part("gh pr create --title t --body b", "output-available", "nothing to report"),
      ]);

      const opened = events.find((event) => event.stage === "opened");
      expect(opened).toBeDefined();
      expect(opened?.url).toBeUndefined();
    });
  });
});
