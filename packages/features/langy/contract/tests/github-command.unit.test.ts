import { describe, expect, it } from "vitest";
import { needsGithubAuth } from "../src/github-command";

describe("needsGithubAuth", () => {
  it("recognises every GitHub CLI invocation", () => {
    for (const command of [
      "gh repo clone acme/foo -- --depth 1",
      "gh pr create --title x --body y --base main",
      "gh repo view --json defaultBranchRef",
      "gh api user --jq .id",
    ]) {
      expect(needsGithubAuth(command), command).toBe(true);
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
      expect(needsGithubAuth(command), command).toBe(true);
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
      expect(needsGithubAuth(command), command).toBe(false);
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
      expect(needsGithubAuth(command), command).toBe(true);
    }

    for (const command of ["", "   ", "&&"]) {
      expect(needsGithubAuth(command), command).toBe(false);
    }
  });
});
