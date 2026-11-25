package cmd

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

// gitCheckout is what haven needs from git about a directory, read from the
// files git keeps rather than by spawning git: every command (the PreToolUse
// gate on each agent tool call included) pays this, and seven `git rev-parse`
// spawns were most of its wall time.
type gitCheckout struct {
	topLevel string
	gitDir   string
	// commonDir is the shared .git of a linked worktree; gitDir otherwise.
	commonDir string
}

// readGitCheckout finds the checkout containing dir. ok is false when the
// files say something this reader does not handle, and the caller then asks
// git itself, so an unusual layout is slower, never wrong.
func readGitCheckout(dir string) (gitCheckout, bool) {
	if os.Getenv("GIT_DIR") != "" || os.Getenv("GIT_WORK_TREE") != "" || os.Getenv("GIT_COMMON_DIR") != "" {
		return gitCheckout{}, false
	}
	abs, err := filepath.Abs(dir)
	if err != nil {
		return gitCheckout{}, false
	}
	if resolved, err := filepath.EvalSymlinks(abs); err == nil {
		abs = resolved
	}
	top, found := nearestGitAncestor(abs)
	if !found {
		return gitCheckout{}, false
	}
	dotGit := filepath.Join(top, ".git")
	info, err := os.Stat(dotGit)
	if err != nil {
		return gitCheckout{}, false
	}
	return checkoutAt(top, dotGit, info.IsDir())
}

// checkoutAt resolves the git directory behind a .git entry: the directory
// itself, or the `gitdir:` a linked worktree or submodule's .git file names.
func checkoutAt(top, dotGit string, isDir bool) (gitCheckout, bool) {
	gitDir := dotGit
	if !isDir {
		raw, err := os.ReadFile(dotGit)
		line := strings.TrimSpace(string(raw))
		if err != nil || !strings.HasPrefix(line, "gitdir:") {
			return gitCheckout{}, false
		}
		gitDir = strings.TrimSpace(strings.TrimPrefix(line, "gitdir:"))
		if !filepath.IsAbs(gitDir) {
			gitDir = filepath.Join(top, gitDir)
		}
	}
	common := gitDir
	if raw, err := os.ReadFile(filepath.Join(gitDir, "commondir")); err == nil { //nolint:gosec // git's own pointer file, named by the checkout's .git
		common = strings.TrimSpace(string(raw))
		if !filepath.IsAbs(common) {
			common = filepath.Join(gitDir, common)
		}
	} else if !os.IsNotExist(err) {
		return gitCheckout{}, false
	}
	return gitCheckout{topLevel: top, gitDir: filepath.Clean(gitDir), commonDir: filepath.Clean(common)}, true
}

// branch is `git rev-parse --abbrev-ref HEAD`: the branch name, or "HEAD"
// when detached. ok is false for a HEAD it does not know.
func (c gitCheckout) branch() (string, bool) {
	raw, err := os.ReadFile(filepath.Join(c.gitDir, "HEAD"))
	if err != nil {
		return "", false
	}
	head := strings.TrimSpace(string(raw))
	if name, isRef := strings.CutPrefix(head, "ref: refs/heads/"); isRef && name != "" {
		return name, true
	}
	if !strings.HasPrefix(head, "ref:") && len(head) >= 40 {
		return "HEAD", true
	}
	return "", false
}

func gitTopLevel(dir string) string {
	if c, ok := readGitCheckout(dir); ok {
		return c.topLevel
	}
	out, err := exec.CommandContext(context.Background(), "git", "-C", dir, "rev-parse", "--show-toplevel").Output()
	if err != nil {
		return dir
	}
	return strings.TrimSpace(string(out))
}

func gitBranch(dir string) string {
	if c, ok := readGitCheckout(dir); ok {
		if name, ok := c.branch(); ok {
			return name
		}
	}
	out, err := exec.CommandContext(context.Background(), "git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD").Output()
	if err != nil {
		return "unknown"
	}
	return strings.TrimSpace(string(out))
}

// gitIsLinkedWorktree reports whether dir is a linked git worktree (created by
// `git worktree add`) rather than the primary checkout: its git directory is
// .git/worktrees/<name>, while the common directory stays the shared .git.
func gitIsLinkedWorktree(dir string) bool {
	if c, ok := readGitCheckout(dir); ok {
		return c.gitDir != c.commonDir
	}
	gitDir, err1 := exec.CommandContext(context.Background(), "git", "-C", dir, "rev-parse", "--git-dir").Output()
	commonDir, err2 := exec.CommandContext(context.Background(), "git", "-C", dir, "rev-parse", "--git-common-dir").Output()
	if err1 != nil || err2 != nil {
		return false
	}
	abs := func(p string) string {
		p = strings.TrimSpace(p)
		if !filepath.IsAbs(p) {
			p = filepath.Join(dir, p)
		}
		if c, err := filepath.Abs(p); err == nil {
			return c
		}
		return p
	}
	return abs(string(gitDir)) != abs(string(commonDir))
}
