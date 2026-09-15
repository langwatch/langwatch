import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(root, "dev/scripts/commit-slice.sh");

function write(directory, path, contents) {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function temporary(t) {
  const directory = mkdtempSync(join(tmpdir(), "langwatch-commit-slice-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function environment(parent, overrides = {}) {
  const globalConfig = join(parent, "gitconfig");
  writeFileSync(globalConfig, "");
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_AUTHOR_NAME: "Test Author",
    GIT_AUTHOR_EMAIL: "author@example.invalid",
    GIT_COMMITTER_NAME: "Test Committer",
    GIT_COMMITTER_EMAIL: "committer@example.invalid",
    ...overrides,
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  if (!("GIT_INDEX_FILE" in overrides)) delete env.GIT_INDEX_FILE;
  return env;
}

function git(directory, env, ...args) {
  const result = spawnSync("git", args, { cwd: directory, env, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout.trimEnd();
}

function attempt(directory, env, list, message = "selected change") {
  return spawnSync("bash", [script, list, message], {
    cwd: directory,
    env,
    encoding: "utf8",
  });
}

function repository(t) {
  const parent = temporary(t);
  const directory = join(parent, "repository");
  mkdirSync(directory);
  const env = environment(parent);
  git(directory, env, "init", "-q", "--initial-branch=main");
  git(directory, env, "config", "commit.gpgSign", "false");
  git(directory, env, "config", "core.hooksPath", join(parent, "no-hooks"));
  write(directory, "selected file.txt", "selected base\n");
  write(directory, "staged.txt", "staged base\n");
  write(directory, "unstaged.txt", "unstaged base\n");
  git(directory, env, "add", "--all");
  git(directory, env, "commit", "-qm", "base");
  return { directory, env, parent };
}

function state(directory, env) {
  return {
    head: git(directory, env, "rev-parse", "HEAD"),
    index: git(directory, env, "ls-files", "--stage"),
    status: git(directory, env, "status", "--porcelain=v1", "--untracked-files=all"),
  };
}

function listFile(parent, contents = "selected file.txt\n") {
  const path = join(parent, "paths");
  writeFileSync(path, contents);
  return path;
}

test("commits only reviewed paths while preserving unrelated staged and unstaged work", (t) => {
  const { directory, env, parent } = repository(t);
  write(directory, "selected file.txt", "selected change\n");
  write(directory, "staged.txt", "staged change\n");
  git(directory, env, "add", "staged.txt");
  write(directory, "unstaged.txt", "unstaged change\n");

  const result = attempt(directory, env, listFile(parent));

  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(directory, env, "show", "HEAD:selected file.txt"), "selected change");
  assert.equal(git(directory, env, "show", "HEAD:staged.txt"), "staged base");
  assert.match(
    git(directory, env, "diff", "--cached", "--", "staged.txt"),
    /-staged base\n\+staged change$/,
  );
  assert.equal(readFileSync(join(directory, "unstaged.txt"), "utf8"), "unstaged change\n");
  assert.match(git(directory, env, "status", "--porcelain"), /^M  staged\.txt\n M unstaged\.txt$/m);
});

describe("an unfinished Git operation", () => {
  for (const scenario of [
    "conflicted merge",
    "resolved merge",
    "cherry-pick",
    "sequenced cherry-pick",
    "rebase",
    "revert",
  ]) {
    test(`refuses a ${scenario} before changing HEAD, the index, or worktree`, (t) => {
      const fixture = repository(t);
      const { directory, env, parent } = fixture;
      write(directory, "selected file.txt", "main side\n");
      git(directory, env, "commit", "-qam", "main side");
      git(directory, env, "switch", "-qc", "topic", "HEAD~1");
      write(directory, "selected file.txt", "topic side\n");
      git(directory, env, "commit", "-qam", "topic side");
      const topic = git(directory, env, "rev-parse", "HEAD");
      if (scenario === "sequenced cherry-pick") {
        write(directory, "second-topic.txt", "second topic change\n");
        git(directory, env, "add", "second-topic.txt");
        git(directory, env, "commit", "-qm", "second topic change");
      }
      const topicTip = git(directory, env, "rev-parse", "HEAD");
      git(directory, env, "switch", "main");

      const runFailing = (...args) => {
        const result = spawnSync("git", args, { cwd: directory, env, encoding: "utf8" });
        assert.notEqual(result.status, 0, `git ${args.join(" ")} unexpectedly succeeded`);
      };
      if (scenario === "conflicted merge" || scenario === "resolved merge") {
        runFailing("merge", "topic");
        if (scenario === "resolved merge") {
          write(directory, "selected file.txt", "resolved merge\n");
          git(directory, env, "add", "selected file.txt");
        }
      } else if (scenario === "cherry-pick") {
        runFailing("cherry-pick", topic);
      } else if (scenario === "sequenced cherry-pick") {
        runFailing("cherry-pick", `${topic}^..${topicTip}`);
      } else if (scenario === "rebase") {
        runFailing("rebase", "topic");
      } else {
        write(directory, "selected file.txt", "later main change\n");
        git(directory, env, "commit", "-qam", "later main change");
        runFailing("revert", "--no-edit", "HEAD~1");
      }

      const before = state(directory, env);
      const contents = readFileSync(join(directory, "selected file.txt"), "utf8");
      const result = attempt(directory, env, listFile(parent));

      assert.notEqual(result.status, 0);
      assert.deepEqual(state(directory, env), before);
      assert.equal(readFileSync(join(directory, "selected file.txt"), "utf8"), contents);
    });
  }
});

test("refuses an unresolved index even when MERGE_HEAD is absent", (t) => {
  const { directory, env, parent } = repository(t);
  write(directory, "selected file.txt", "main side\n");
  git(directory, env, "commit", "-qam", "main side");
  git(directory, env, "switch", "-qc", "topic", "HEAD~1");
  write(directory, "selected file.txt", "topic side\n");
  git(directory, env, "commit", "-qam", "topic side");
  git(directory, env, "switch", "main");
  spawnSync("git", ["merge", "topic"], { cwd: directory, env, encoding: "utf8" });
  const mergeHead = git(directory, env, "rev-parse", "--git-path", "MERGE_HEAD");
  rmSync(join(directory, mergeHead), { force: true });
  const before = state(directory, env);

  const result = attempt(directory, env, listFile(parent));

  assert.notEqual(result.status, 0);
  assert.deepEqual(state(directory, env), before);
});

test("refuses an inherited alternate index without touching either index", (t) => {
  const { directory, env, parent } = repository(t);
  write(directory, "selected file.txt", "selected change\n");
  const alternateIndex = join(parent, "alternate-index");
  const alternateEnv = { ...env, GIT_INDEX_FILE: alternateIndex };
  git(directory, alternateEnv, "read-tree", "HEAD");
  const beforeLive = state(directory, env);
  const beforeAlternate = readFileSync(alternateIndex);

  const result = attempt(directory, alternateEnv, listFile(parent));

  assert.notEqual(result.status, 0);
  assert.deepEqual(state(directory, env), beforeLive);
  assert.deepEqual(readFileSync(alternateIndex), beforeAlternate);
});

test("detects an unfinished merge from a linked worktree", (t) => {
  const { directory, env, parent } = repository(t);
  write(directory, "selected file.txt", "main side\n");
  git(directory, env, "commit", "-qam", "main side");
  git(directory, env, "branch", "topic", "HEAD~1");
  const linked = join(parent, "linked worktree");
  git(directory, env, "worktree", "add", "-q", "-b", "linked", linked, "topic");
  write(linked, "selected file.txt", "linked side\n");
  git(linked, env, "commit", "-qam", "linked side");
  const linkedCommit = git(linked, env, "rev-parse", "HEAD");
  spawnSync("git", ["merge", "main"], { cwd: linked, env, encoding: "utf8" });
  const before = state(linked, env);

  const result = attempt(linked, env, listFile(parent));

  assert.notEqual(result.status, 0);
  assert.deepEqual(state(linked, env), before);
  assert.equal(git(directory, env, "rev-parse", "linked"), linkedCommit);
});
