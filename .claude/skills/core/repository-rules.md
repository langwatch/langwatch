# Repository rules

Canonical. Every agent working in this repository follows these, whether it was
started by a person, by the coordinator, or by a skill. A brief or manifest may
add rules; it may not relax one of these.

The root `CLAUDE.md` is the architecture and command reference and is already in
your context - this file does not restate it. What is here is the operating
discipline: the things agents have actually got wrong, at cost.

## 1. Secrets

Never read `.env`, `.env.*`, `.claude/.env`, `settings.local.json`, or any file
whose purpose is to carry a credential. Never print a secret, and mask hostnames
and connection URLs in anything you quote back.

Never source a dotenv file in a shell. An unquoted multi-line value (a PEM key,
for instance) is echoed by `.` and lands in the transcript. Use `node --env-file`
or a tool's own env-file flag.

Values you need come through the secrets chain, never from `process.env` read
directly outside the places allowed to do so. If a value is genuinely missing,
stop and say which key is missing by name - do not go looking for it.

## 2. Checks are scoped, always

A whole-tree typecheck holds 2.3 to 3.5 GiB and every core on the machine. Run
four at once across worktrees and the machine stops. So:

- **Never** `pnpm typecheck`, `pnpm typecheck:all`, `pnpm lint`, `pnpm format`,
  or `tsc -p apps/...`, unless the task you were given is explicitly to run one.
- While working: `tsc --noEmit --ignoreConfig <file>` on the file you just
  edited, or `tslsp-cli diagnostics --file F`.
- Once, at the end, for the package you touched: `pnpm typecheck:one <package>`.

These go through the machine-wide slot queue and can block for minutes. That is
correct behaviour, not a hang - but it is why a mid-work `typecheck:one` is
wasteful and an end-of-work one is not.

Test rules are in `testing-rules.md`.

## 3. Git

Lanes do not write to git. No `git add`, `git commit`, `git stash`,
`git checkout`, `git reset`, `git restore`, `git mv`, `git rebase`, `git push`.
The coordinator commits; a lane reports what it changed and stops. A lane that
commits has taken a shared resource that other lanes are standing in.

Plain shell `mv` is fine and is how a lane moves a file - it is `git mv` that is
banned, because that one stages. Read commands (`git status`, `git diff`,
`git grep`, `git ls-files`, `git show`) are always fine.

For whoever is committing:

- Commit by explicit pathspec, never `git add -A` and never `git add .` while
  another agent is editing. Name the directories.
- Build the untracked half of a slice from `git ls-files --others
  --exclude-standard <dirs>`, never from `git status` rows. A status row for an
  untracked directory names the *directory*, not its files, and a slice built
  that way once dropped 136 files.
- Never `git stash` in a shared checkout. The stash stack is global and a bare
  `stash push` takes every other agent's work with it.
- Never open a PR or push unless the task says to.

Generated and baseline files are dirty by default and cannot be sliced cleanly.
Do not sweep them into someone else's commit; say which rows you closed and let
the coordinator apply them.

## 4. Ownership

A lane edits only the paths its manifest lists as **owned**. Everything else in
the tree is read-only to it, including paths no one currently owns.

Shared files belong to the coordinator alone. A lane that needs one changed does
not change it: it records the exact lines under `Shared-file requests` in its
handoff and continues with what it can still do. If nothing remains, it stops
with status `blocked`.

The shared set for this repository - composition roots, process doors, the
catalogue, and the lint baselines - is listed in
`.claude/coordinator/COORDINATOR.md`, which is where it is maintained. A file is
shared if two lanes could plausibly need it in the same hour.

## 5. Identifiers go through the language server

Never grep or `sed` for a symbol you intend to rename or move. From the package
directory holding the `tsconfig.json`:

```
npx --no-install @0xdeafcafe/tslsp-cli references --symbol Name --summary
npx --no-install @0xdeafcafe/tslsp-cli rename --symbol Old --new-name New --dry-run
npx --no-install @0xdeafcafe/tslsp-cli rename-file OLD NEW    # rewrites imports
npx --no-install @0xdeafcafe/tslsp-cli diagnostics --file F
```

A package's program sees its own files and its workspace dependencies, so run
the same command from `apps/api` or `apps/worker` to find consumers there.

Two things the language server cannot see, so check them by hand after any
rename or move: `vi.mock("<path>")` strings, and tests that read source files as
text. Both survive a rename silently and fail at runtime.

## 6. Do not widen the job

Fix what the manifest names. A broken thing you noticed next door goes in the
handoff under `Risks`, not into the diff. Broad unrelated cleanup passes are how
a bounded task becomes a 2,000-file diff nobody can review, and they collide
with every other lane.

Specifically: no repository-wide rename, no reformat of files you did not
otherwise change, no dependency upgrade, no "while I was here" refactor.

## 7. Keep the tree bootable

The developer runs this branch while you work. Every step you land keeps it
starting:

- Declare a new dependency in `package.json` and run `env -u CI pnpm install
  --filter "<package>..."` **before** the first import of it is written.
- Delete an export only in the same step that repoints or removes its importers.
  Check with `tslsp-cli references` first.
- Change a constructor's shape and every caller in the same step.

After a step lands, read `haven logs backend --since 2m --agent`. A
`SyntaxError`, an `ERR_MODULE_NOT_FOUND` or a fatal boot failure naming your
files is your defect - fix it before doing anything else.

## 8. Cost

Cost is the sum of the context over every turn, so it grows with the square of
the number of turns. Cache misses are already near zero; the lever is **fewer,
fatter turns**, not a warmer cache.

- Join shell commands with `&&` into one call rather than three.
- Read a file once. Prefer `tslsp-cli outline FILE`, then read the one range you
  need. Never read a large file whole to find one function.
- Filter every tool output: `tail`, `grep`, `--reporter=dot`. A raw log is re-read
  on every subsequent turn, at full price, forever.
- A framework signature is `tslsp-cli hover --symbol X`, not a read of the
  framework's source.
- Prefix shell commands with `rtk` where a filter exists (`rtk git`, `rtk pnpm`,
  `rtk grep`); it is a passthrough when there is none, so it is always safe.

**Do not let one tool call outlive the prompt cache.** The cache TTL depends on
who you are: a main session gets an hour, a **subagent gets five minutes**. A
single call that runs longer than your TTL discards the whole context and re-reads
it at full price on the next turn.

So a lane keeps every call under about four minutes. Anything genuinely longer -
an install, a Go build, a stack wait - goes to the background and is checked
back. A vitest run is never backgrounded and never cut; it is kept short by
scope instead.

When you reach your budget, stop and write the handoff. Do not push on. A fresh
lane started from a good handoff is dramatically cheaper than a resumed one,
because a resumed lane pays for its entire history again on every further turn.

## 9. Prose style

British English. No em dashes - write " - " instead. No attribution lines, no
session links and no agent names in commit messages, PR bodies or specs.

Never name a client or a customer in this repository. It is public.

Comments at most five lines, and only where the code cannot say it. A comment
that describes behaviour the code does not implement is a defect: delete it or
implement it.
