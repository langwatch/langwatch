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
			action = "reuse"
		}
		install := "pnpm install, then "
		if p.NoInstall {
			install = ""
		}
		fmt.Printf("would %s worktree %s (branch %s) from PR #%d (%s), %shaven up\n",
			action, worktree, branch, view.Number, view.HeadRefName, install)
		return nil
	}

	if isDir(worktree) {
		fmt.Printf("↺ reusing existing worktree %s\n", worktree)
	} else {
		fmt.Printf("→ PR #%d (%s) → %s\n", view.Number, view.HeadRefName, worktree)
		if err := ensurePRWorktree(ctx, p.RepoRoot, view.Number, branch, worktree); err != nil {
			return err
		}
	}

	if !p.NoInstall {
		fmt.Printf("→ pnpm install\n")
		if err := runStreaming(ctx, worktree, "pnpm", "install"); err != nil {
			return fmt.Errorf("pnpm install failed in %s: %w", worktree, err)
		}
	}

	fmt.Printf("→ haven up (%s)\n", filepath.Base(worktree))
	return runUp(ctx, worktree)
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
