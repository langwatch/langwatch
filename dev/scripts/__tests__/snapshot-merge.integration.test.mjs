import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const script = join(root, "dev/scripts/snapshot-merge.sh");

function write(directory, path, contents) {
  const target = join(directory, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, contents);
}

function fixture(t) {
  const parent = mkdtempSync(join(tmpdir(), "langwatch-snapshot-merge-"));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const directory = join(parent, "repository");
  mkdirSync(directory);
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
  };
  delete env.GIT_DIR;
  delete env.GIT_WORK_TREE;
  delete env.GIT_INDEX_FILE;
  git(directory, env, "init", "-q", "--initial-branch=main");
  git(directory, env, "config", "commit.gpgSign", "false");
  git(directory, env, "config", "core.hooksPath", join(parent, "no-hooks"));
  write(directory, "shared.txt", "base\n");
  write(directory, "tracked.txt", "tracked base\n");
  git(directory, env, "add", "--all");
  git(directory, env, "commit", "-qm", "base");
  return { directory, env, parent };
}

function git(directory, env, ...args) {
  const result = spawnSync("git", args, { cwd: directory, env, encoding: "utf8" });
  assert.equal(result.status, 0, `git ${args.join(" ")}\n${result.stdout}${result.stderr}`);
  return result.stdout.trimEnd();
}

function attempt(directory, env, ref = "refs/heads/wip/merge-partial-test") {
  return spawnSync("bash", [script, ref, "merge checkpoint"], {
    cwd: directory,
    env,
    encoding: "utf8",
  });
}

function state(directory, env) {
  const mergeHeadPath = git(directory, env, "rev-parse", "--git-path", "MERGE_HEAD");
  return {
    head: git(directory, env, "rev-parse", "HEAD"),
    index: git(directory, env, "ls-files", "--stage"),
    mergeHeads: readFileSync(
      isAbsolute(mergeHeadPath) ? mergeHeadPath : join(directory, mergeHeadPath),
      "utf8",
    ),
    status: git(directory, env, "status", "--porcelain=v1", "--untracked-files=all"),
  };
}

function conflictingLinkedWorktree(t, resolved) {
  const result = fixture(t);
  const { directory, env, parent } = result;
  write(directory, "shared.txt", "main side\n");
  git(directory, env, "commit", "-qam", "main side");
  git(directory, env, "branch", "topic", "HEAD~1");
  const linked = join(parent, "linked worktree");
  git(directory, env, "worktree", "add", "-q", "-b", "linked", linked, "topic");
  write(linked, "shared.txt", "topic side\n");
  git(linked, env, "commit", "-qam", "topic side");
  const merge = spawnSync("git", ["merge", "main"], { cwd: linked, env, encoding: "utf8" });
  assert.notEqual(merge.status, 0);
  write(
    linked,
    "shared.txt",
    resolved ? "owned resolution\n" : "<<<<<<< owned\nunresolved checkpoint\n>>>>>>> main\n",
  );
  if (resolved) git(linked, env, "add", "shared.txt");
  return { ...result, linked };
}

for (const resolved of [false, true]) {
  test(`snapshots a ${resolved ? "resolved" : "conflicted"} merge in a linked worktree without continuing it`, (t) => {
    const { directory, linked, env } = conflictingLinkedWorktree(t, resolved);
    const before = state(linked, env);
    const contents = readFileSync(join(linked, "shared.txt"), "utf8");
    const result = attempt(linked, env);

    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(state(linked, env), before);
    assert.equal(readFileSync(join(linked, "shared.txt"), "utf8"), contents);
    assert.equal(
      git(directory, env, "show", "refs/heads/wip/merge-partial-test:shared.txt"),
      contents.trimEnd(),
    );
    assert.deepEqual(
      git(directory, env, "show", "-s", "--format=%P", "refs/heads/wip/merge-partial-test").split(
        " ",
      ),
      [before.head, before.mergeHeads.trim()],
    );
    assert.equal(git(linked, env, "rev-parse", "HEAD"), before.head);
  });
}

test("captures tracked work and already-staged new files with every merge parent", (t) => {
  const { directory, env } = fixture(t);
  git(directory, env, "switch", "-qc", "topic-a");
  write(directory, "a.txt", "topic a\n");
  git(directory, env, "add", "a.txt");
  git(directory, env, "commit", "-qm", "topic a");
  const topicA = git(directory, env, "rev-parse", "HEAD");
  git(directory, env, "switch", "-qc", "topic-b", "main");
  write(directory, "b.txt", "topic b\n");
  git(directory, env, "add", "b.txt");
  git(directory, env, "commit", "-qm", "topic b");
  const topicB = git(directory, env, "rev-parse", "HEAD");
  git(directory, env, "switch", "main");
  git(directory, env, "merge", "--no-commit", "topic-a", "topic-b");
  write(directory, "tracked.txt", "tracked checkpoint\n");
  write(directory, "staged-new.txt", "staged new\n");
  git(directory, env, "add", "staged-new.txt");
  write(directory, "untracked.txt", "must stay untracked\n");
  const before = state(directory, env);

  const result = attempt(directory, env);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(state(directory, env), before);
  assert.equal(
    git(directory, env, "show", "refs/heads/wip/merge-partial-test:tracked.txt"),
    "tracked checkpoint",
  );
  assert.equal(
    git(directory, env, "show", "refs/heads/wip/merge-partial-test:staged-new.txt"),
    "staged new",
  );
  const missing = spawnSync(
    "git",
    ["cat-file", "-e", "refs/heads/wip/merge-partial-test:untracked.txt"],
    { cwd: directory, env },
  );
  assert.notEqual(missing.status, 0);
  assert.deepEqual(
    git(directory, env, "show", "-s", "--format=%P", "refs/heads/wip/merge-partial-test").split(
      " ",
    ),
    [before.head, topicA, topicB],
  );
});

test("refuses no merge, an existing destination, and an inherited alternate index without mutations", (t) => {
  const { directory, env, parent } = fixture(t);
  const initialHead = git(directory, env, "rev-parse", "HEAD");
  assert.notEqual(attempt(directory, env).status, 0);
  assert.equal(git(directory, env, "rev-parse", "HEAD"), initialHead);

  git(directory, env, "update-ref", "refs/heads/wip/merge-partial-test", initialHead);
  git(directory, env, "switch", "-qc", "topic");
  write(directory, "tracked.txt", "topic\n");
  git(directory, env, "commit", "-qam", "topic");
  git(directory, env, "switch", "main");
  write(directory, "shared.txt", "main diverged\n");
  git(directory, env, "commit", "-qam", "main diverged");
  git(directory, env, "merge", "--no-commit", "topic");
  const before = state(directory, env);
  assert.notEqual(attempt(directory, env).status, 0);
  assert.deepEqual(state(directory, env), before);
  assert.equal(git(directory, env, "rev-parse", "refs/heads/wip/merge-partial-test"), initialHead);

  const alternateIndex = join(parent, "alternate-index");
  const alternateEnv = { ...env, GIT_INDEX_FILE: alternateIndex };
  git(directory, alternateEnv, "read-tree", "HEAD");
  const alternateBefore = readFileSync(alternateIndex);
  assert.notEqual(
    attempt(directory, alternateEnv, "refs/heads/wip/merge-partial-alternate").status,
    0,
  );
  assert.deepEqual(readFileSync(alternateIndex), alternateBefore);
  assert.deepEqual(state(directory, env), before);
});
