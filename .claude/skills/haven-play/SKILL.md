---
name: haven-play
description: "Try a GitHub PR on this machine with `haven pr` (own worktree, install, stack on a hostname) or `haven pr <n> --throwaway` (a throwaway sandbox that destroys itself on quit; formerly `haven play`). Use when someone says 'try a PR locally', 'haven pr', 'haven play', 'haven pr --throwaway', 'run this PR in a sandbox', 'review a PR by running it', 'play a PR', 'throwaway stack', or 'worktree overview' (`haven git` is deleted)."
user-invocable: true
argument-hint: "pr <number> [--throwaway]"
---

# haven pr and haven pr --throwaway

| Command                    | What it does                                           | Quitting           |
| -------------------------- | ------------------------------------------------------ | ------------------ |
| `haven pr <n>`             | worktree + install + stack up on a hostname            | keeps everything   |
| `haven pr <n> --throwaway` | own checkout, own databases, own hostname in a sandbox | DESTROYS all of it |

```bash
haven pr 4913 --dry-run                    # resolve and print the plan, create nothing
haven pr 4913                              # the real run
haven pr 4913 --throwaway --seed demo                # seeded sandbox; presets bare|demo|onboarding|post-onboarding
haven pr 4913 --throwaway --allow-untrusted          # the only way in agent mode when an author lacks write access
```

`haven pr` flags: `--dry-run`, `--no-install`, `--allow-closed`, `--allow-scripts` (install lifecycle
scripts for a fork), `--discard-local-changes` (overwrite local edits instead of stashing).
Worktrees land in `HAVEN_WORKTREE_DIR`.

- `haven pr --throwaway` needs the GitHub CLI (`gh auth login`), discloses the destruction contract, passes a trust
  gate, starts a container tier, and tears down on quit (a hard kill leaves a record that `haven machine clean`
  finishes). An agent never runs it without being asked. Untrusted PR checkouts install without
  lifecycle scripts.
- Prefer a repo worktree via `make worktree <name>` for your own work; `pr` and `pr --throwaway` are for
  other people's code.
- `haven git` and `haven play` are retired spellings: they exit 64 and name the new one.
