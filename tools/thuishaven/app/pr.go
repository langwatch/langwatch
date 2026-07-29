package app

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
)

// TryPRParams configure `haven pr`: bring a GitHub PR up locally in a worktree.
type TryPRParams struct {
	Ref          string // PR number or a github.com/.../pull/N URL
	RepoRoot     string // the repo to run git/gh from (any worktree of it)
	WorktreeBase string // dir new PR worktrees are created under
	NoInstall    bool   // skip `pnpm install`
	Force        bool   // proceed even if the PR is not open
	DryRun       bool   // resolve + print the plan, create nothing
	AllowScripts bool   // run install lifecycle scripts even for a fork PR (--trusted)
	// DiscardLocalChanges overwrites a reused worktree's uncommitted tracked edits
	// on refresh instead of stashing them first (--discard-local-changes). Off by
	// default: a refresh autostashes local work so nothing is ever silently lost.
	DiscardLocalChanges bool
}

// prView is the slice of `gh pr view --json` we read.
type prView struct {
	Number            int    `json:"number"`
	State             string `json:"state"`
	HeadRefName       string `json:"headRefName"`
	IsCrossRepository bool   `json:"isCrossRepository"`
	URL               string `json:"url"`
}

// TryPR resolves a GitHub PR to a git worktree, wires it up, and hands off to
// `haven up` in it — so a teammate's PR is serving on a hostname in seconds. The
// repo's post-checkout hook copies the .env files into the new worktree, and
// `pnpm install` populates node_modules; `haven up` then does the usual
// codegen/migrate/seed/supervise. runUp is injected (it re-invokes the haven
// binary with cwd set to the worktree) so this stays out of the composition
// root's business and its pure parts stay testable.
//
// This is the MVP golden path: shared Postgres/ClickHouse/Redis (a fresh DB per
// PR, exactly as `up` always does). Private per-PR backends (-p/-c, an
// always-private Redis) and idle reaping are the follow-ups scoped in
// specs/setup/haven-try-pr-plan.md.
func TryPR(
	ctx context.Context,
	p TryPRParams,
	runUp func(context.Context, string) error,
) error {
	ref := strings.TrimSpace(p.Ref)
	if !looksLikePRRef(ref) {
		return fmt.Errorf(
			"usage: haven pr <number|github-pr-url> [--no-install] [--force]\n" +
				"  e.g. haven pr 4913  |  haven pr https://github.com/langwatch/langwatch/pull/4913")
	}
	if _, err := exec.LookPath("gh"); err != nil {
		return fmt.Errorf("the GitHub CLI `gh` is required — install it (https://cli.github.com) and run `gh auth login`")
	}

	view, err := resolvePR(ctx, p.RepoRoot, ref)
	if err != nil {
		return err
	}
	if view.State != "OPEN" && !p.Force {
		return fmt.Errorf("PR #%d is %s, not open — pass --force to try it anyway",
			view.Number, strings.ToLower(view.State))
	}

	worktree := prWorktreePath(p.WorktreeBase, view.Number)
	branch := prBranchName(view.Number)

	if p.DryRun {
		action := "create"
		if isDir(worktree) {
			action = "reuse (fetch to head)"
		}
		install := "pnpm install, then "
		if p.NoInstall {
			install = ""
		} else if view.IsCrossRepository && !p.AllowScripts {
			install = "pnpm install --ignore-scripts (fork), then "
		}
		fmt.Printf("would %s worktree %s (branch %s) from PR #%d (%s), %shaven up\n",
			action, worktree, branch, view.Number, view.HeadRefName, install)
		return nil
	}

	if isDir(worktree) {
		// "haven pr" means "try the CURRENT state of the PR", so a reused worktree
		// must be brought up to the PR's head — otherwise a push-then-retry silently
		// serves stale code. refreshPRWorktree also fails loudly if the dir is not a
		// usable git worktree, so isDir alone isn't trusted as the reuse gate.
		fmt.Printf("↺ reusing existing worktree %s — refreshing to PR head\n", worktree)
		if err := refreshPRWorktree(ctx, worktree, view.Number, p.DiscardLocalChanges); err != nil {
			return err
		}
	} else {
		fmt.Printf("→ PR #%d (%s) → %s\n", view.Number, view.HeadRefName, worktree)
		if err := ensurePRWorktree(ctx, p.RepoRoot, view.Number, branch, worktree); err != nil {
			return err
		}
	}

	if !p.NoInstall {
		if err := installDeps(ctx, worktree, view, p.AllowScripts); err != nil {
			return err
		}
	}

	fmt.Printf("→ haven up (%s)\n", filepath.Base(worktree))
	return runUp(ctx, worktree)
}

// installDeps runs pnpm install in the PR worktree. For a fork (cross-repo) PR it
// defaults to --ignore-scripts: this repo has a postinstall, and a fork controls
// package scripts, so a plain install would execute fork-authored code with the
// developer's local env/credentials the instant they try the PR. --trusted opts
// back into full lifecycle scripts. (Same-repo PRs are as trusted as the base, so
// they install normally.) Note: `haven up` still runs the PR's application code —
// only try PRs you would be willing to run locally.
func installDeps(ctx context.Context, worktree string, view prView, allowScripts bool) error {
	args := pnpmInstallArgs(view, allowScripts)
	if sanitizedInstall(view, allowScripts) {
		fmt.Printf("⚠ fork PR (%s): installing with --ignore-scripts so its lifecycle scripts don't run.\n",
			view.HeadRefName)
		fmt.Printf("  Pass --trusted to allow them. (haven up still runs the PR's app code.)\n")
	}
	fmt.Printf("→ pnpm %s\n", strings.Join(args, " "))
	if err := runStreaming(ctx, worktree, "pnpm", args...); err != nil {
		return fmt.Errorf("pnpm install failed in %s: %w", worktree, err)
	}
	return nil
}

// sanitizedInstall reports whether a fork PR's install must skip lifecycle
// scripts: cross-repo (a fork controls package scripts) and not explicitly
// trusted. Same-repo PRs are as trusted as the base and install normally.
func sanitizedInstall(view prView, allowScripts bool) bool {
	return view.IsCrossRepository && !allowScripts
}

// pnpmInstallArgs is the pnpm argv for a PR install — sanitized (no lifecycle
// scripts) for an untrusted fork, plain otherwise.
func pnpmInstallArgs(view prView, allowScripts bool) []string {
	if sanitizedInstall(view, allowScripts) {
		return []string{"install", "--ignore-scripts"}
	}
	return []string{"install"}
}

// refreshPRWorktree brings an already-existing PR worktree up to the PR's current
// head. The PR head branch (haven-pr-N) is checked out here, and git refuses to
// fetch straight into a checked-out branch, so fetch to FETCH_HEAD and hard-reset
// onto it — which moves the branch and the working tree to the latest commit.
//
// The hard-reset would silently clobber any uncommitted edits a developer made
// while poking at the PR, so by default we autostash them first (the same safety
// net `git rebase`/`git pull` get from --autostash) — nothing is lost, and the
// stash's sha is printed so they can restore exactly those edits. --discard-local-
// changes opts out and overwrites instead. (git reset --hard only destroys
// tracked-file modifications; untracked files survive it, and stashing them would
// sweep up the generated artifacts a prior `haven up` leaves behind — so both the
// dirty-check and the stash are scoped to tracked changes.)
func refreshPRWorktree(ctx context.Context, worktree string, number int, discardLocalChanges bool) error {
	dirty, err := worktreeHasTrackedChanges(ctx, worktree)
	if err != nil {
		return err
	}
	if dirty {
		if discardLocalChanges {
			fmt.Printf("⚠ --discard-local-changes: overwriting uncommitted edits in %s\n", worktree)
		} else if err := autostashLocalChanges(ctx, worktree, number); err != nil {
			return err
		}
	}
	fetchSpec := fmt.Sprintf("pull/%d/head", number)
	if err := runStreaming(ctx, worktree, "git", "fetch", "-f", "origin", fetchSpec); err != nil {
		return fmt.Errorf("git fetch %s (reuse) in %s: %w", fetchSpec, worktree, err)
	}
	if err := runStreaming(ctx, worktree, "git", "reset", "--hard", "FETCH_HEAD"); err != nil {
		return fmt.Errorf("git reset --hard FETCH_HEAD in %s: %w", worktree, err)
	}
	return nil
}

// autostashLocalChanges tucks the worktree's uncommitted tracked edits into a git
// stash before a refresh clobbers them. It prints the stash's commit sha so the
// developer restores exactly these edits with `git stash apply <sha>` — apply, not
// pop, and by sha, because git's stash stack is shared across every worktree of
// the repo, so a bare pop could grab another worktree's entry.
func autostashLocalChanges(ctx context.Context, worktree string, number int) error {
	msg := fmt.Sprintf("haven pr %d: autostash before refresh", number)
	if err := runStreaming(ctx, worktree, "git", "stash", "push", "-m", msg); err != nil {
		return fmt.Errorf("git stash in %s failed: %w", worktree, err)
	}
	sha, err := gitRevParse(ctx, worktree, "stash@{0}")
	if err != nil {
		// The stash exists; we just couldn't resolve its sha for the hint.
		fmt.Printf("↥ stashed your local changes (find it with `git stash list`, restore with `git stash apply`)\n")
		return nil
	}
	fmt.Printf("↥ stashed your local changes — restore them here with: git stash apply %s\n", sha)
	return nil
}

// worktreeHasTrackedChanges reports whether the worktree has staged or unstaged
// modifications to tracked files — a non-empty `git status --porcelain
// --untracked-files=no`. A git error (e.g. the dir isn't a usable worktree)
// surfaces loudly, doubling as the reuse-gate isDir alone can't provide.
func worktreeHasTrackedChanges(ctx context.Context, worktree string) (bool, error) {
	out, err := gitOutput(ctx, worktree, "status", "--porcelain", "--untracked-files=no")
	if err != nil {
		return false, fmt.Errorf("git status in %s failed (is it a git worktree?)%s", worktree, gitStderrHint(err))
	}
	return porcelainIsDirty(out), nil
}

// gitRevParse resolves a rev (e.g. "stash@{0}") to its full sha in the worktree.
func gitRevParse(ctx context.Context, worktree, rev string) (string, error) {
	out, err := gitOutput(ctx, worktree, "rev-parse", rev)
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(out), nil
}

// gitOutput runs a git subcommand in worktree and returns its stdout.
func gitOutput(ctx context.Context, worktree string, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "git", args...)
	cmd.Dir = worktree
	out, err := cmd.Output()
	return string(out), err
}

// gitStderrHint turns an *exec.ExitError's captured stderr into a `: <msg>`
// suffix for error wrapping, or "" when there's nothing useful.
func gitStderrHint(err error) string {
	if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
		return ": " + strings.TrimSpace(string(ee.Stderr))
	}
	return ""
}

// porcelainIsDirty reports whether `git status --porcelain` output signals
// changes — any non-blank content. Split out so the decision is unit-testable
// without a real worktree.
func porcelainIsDirty(status string) bool {
	return strings.TrimSpace(status) != ""
}

// resolvePR asks gh for the PR's number/state/head. gh accepts a bare number
// (resolved against RepoRoot's default remote) or a full URL.
func resolvePR(ctx context.Context, repoRoot, ref string) (prView, error) {
	cmd := exec.CommandContext(ctx, "gh", "pr", "view", ref,
		"--json", "number,state,headRefName,isCrossRepository,url")
	cmd.Dir = repoRoot
	out, err := cmd.Output()
	if err != nil {
		hint := ""
		if ee, ok := err.(*exec.ExitError); ok && len(ee.Stderr) > 0 {
			hint = ": " + strings.TrimSpace(string(ee.Stderr))
		}
		return prView{}, fmt.Errorf(
			"could not read PR %q via gh (is it authed? run `gh auth login`)%s", ref, hint)
	}
	var v prView
	if err := json.Unmarshal(out, &v); err != nil {
		return prView{}, fmt.Errorf("unexpected gh output for PR %q: %w", ref, err)
	}
	if v.Number == 0 {
		return prView{}, fmt.Errorf("gh returned no PR number for %q", ref)
	}
	return v, nil
}

// ensurePRWorktree fetches the PR head into a local branch and adds a worktree on
// it. `pull/N/head` is exposed on the BASE repo for both same-repo and fork PRs,
// so this needs no fork remote and works for any PR the user can read.
func ensurePRWorktree(ctx context.Context, repoRoot string, number int, branch, worktree string) error {
	fetchSpec := fmt.Sprintf("pull/%d/head:%s", number, branch)
	if err := runStreaming(ctx, repoRoot, "git", "fetch", "-f", "origin", fetchSpec); err != nil {
		return fmt.Errorf("git fetch %s: %w", fetchSpec, err)
	}
	if err := os.MkdirAll(filepath.Dir(worktree), 0o755); err != nil {
		return fmt.Errorf("could not create worktrees dir: %w", err)
	}
	if err := runStreaming(ctx, repoRoot, "git", "worktree", "add", worktree, branch); err != nil {
		return fmt.Errorf("git worktree add %s: %w", worktree, err)
	}
	return nil
}

// runStreaming runs a child with the user's own stdio, so git/pnpm progress is
// visible live (this command is meant to be watched).
func runStreaming(ctx context.Context, dir, name string, args ...string) error {
	cmd := exec.CommandContext(ctx, name, args...)
	cmd.Dir = dir
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	cmd.Stdin = os.Stdin
	return cmd.Run()
}

// --- pure helpers (unit-tested) ---

// looksLikePRRef fails fast on obvious non-PRs before shelling out to gh, which
// does the real validation. A bare integer or a github.com pull URL qualifies.
func looksLikePRRef(ref string) bool {
	if ref == "" {
		return false
	}
	if n, err := strconv.Atoi(ref); err == nil {
		return n > 0
	}
	return strings.Contains(ref, "github.com") && strings.Contains(ref, "/pull/")
}

// prBranchName is the local branch the PR head is fetched into — namespaced so it
// never collides with a real branch of the same name.
func prBranchName(number int) string {
	return fmt.Sprintf("haven-pr-%d", number)
}

// prWorktreePath keeps the slug deterministic: a dir named pr-<n> sanitises to
// the slug pr-<n>, so the PR lands at app.pr-<n>.langwatch.localhost.
func prWorktreePath(base string, number int) string {
	return filepath.Join(base, fmt.Sprintf("pr-%d", number))
}

func isDir(p string) bool {
	fi, err := os.Stat(p)
	return err == nil && fi.IsDir()
}
