package visualdiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// WorktreesDir holds one worktree per side that outlives the run, so the next
// run moves it to its commit instead of adding a fresh one: node_modules,
// generated files, built dists and Vite's dependency cache are all still warm,
// and there is no worktree to remove at the end. gc never collects them.
const WorktreesDir = "worktrees"

const (
	// worktreeOwnerSuffix names the file beside a persistent worktree that
	// records which run holds it; a live or kept owner keeps others out.
	worktreeOwnerSuffix = ".owner"
	// worktreePreparedSuffix names the file beside a persistent worktree that
	// records the key of the prepare it last finished.
	worktreePreparedSuffix = ".prepared"
)

// PersistentWorktree is where one side's reusable worktree lives.
func PersistentWorktree(root, side string) string {
	return filepath.Join(root, ".visualdiff", WorktreesDir, side)
}

// claimWorktree decides where a side checks out: its persistent worktree,
// unless another run that is still alive or kept holds it, when the run falls
// back to a worktree of its own that teardown removes.
func claimWorktree(root, runDir, side string) (string, bool, error) {
	dir := PersistentWorktree(root, side)
	if holder := worktreeOwner(dir); holder != "" && holder != runDir && dirExists(holder) {
		state := readRunState(holder, ProcessAlive)
		if state.Alive || state.Kept {
			return filepath.Join(runDir, side), false, nil
		}
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o750); err != nil {
		return "", false, err
	}
	if err := os.WriteFile(dir+worktreeOwnerSuffix, []byte(runDir+"\n"), 0o600); err != nil {
		return "", false, err
	}
	return dir, true, nil
}

// worktreeOwner is the run directory that holds a persistent worktree, or "".
func worktreeOwner(dir string) string {
	owner, err := os.ReadFile(dir + worktreeOwnerSuffix) // #nosec G304 -- a file under the tool's own .visualdiff directory.
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(owner))
}

// releaseWorktree lets the next run take a persistent worktree this run held.
func releaseWorktree(dir, runDir string) {
	if worktreeOwner(dir) == runDir {
		_ = os.Remove(dir + worktreeOwnerSuffix)
	}
}

// PersistentCheckoutCommands move a persistent worktree to commit, adding it
// the first time. --force discards what a previous prepare wrote over tracked
// files; ignored files (node_modules, dists, .vite) are what the reuse keeps.
func PersistentCheckoutCommands(dir, commit string, exists bool) []commandSpec {
	if exists {
		return []commandSpec{{name: "git", args: []string{"checkout", "--detach", "--force", commit}, dir: dir}}
	}
	return []commandSpec{
		{name: "git", args: []string{"worktree", "prune"}},
		{name: "git", args: []string{"worktree", "add", "--force", "--detach", dir, commit}},
	}
}

// isWorktree reports a directory git already checked a worktree out into.
func isWorktree(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

// PrepareKey is what a prepare's output depends on: the layout, the commands
// and the commit's whole tree. The same key means the worktree already holds
// exactly what the commands would write.
func PrepareKey(layout Layout, tree string, commands []commandSpec) string {
	digest := sha256.New()
	fmt.Fprintf(digest, "layout=%s\ntree=%s\n", layout, tree)
	for _, command := range commands {
		fmt.Fprintf(digest, "%s %s\n", command.name, strings.Join(command.args, " "))
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// preparedKey is the key a persistent worktree's last finished prepare recorded.
func preparedKey(dir string) string {
	recorded, err := os.ReadFile(dir + worktreePreparedSuffix) // #nosec G304 -- a file under the tool's own .visualdiff directory.
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(recorded))
}

// recordPrepared stores a finished prepare's key, or forgets it with "" so a
// prepare that fails half-way is never read as done.
func recordPrepared(dir, key string) error {
	if key == "" {
		if err := os.Remove(dir + worktreePreparedSuffix); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
		return nil
	}
	return os.WriteFile(dir+worktreePreparedSuffix, []byte(key+"\n"), 0o600)
}

// resolveTree names the tree a commit checks out, the input a prepare depends on.
func resolveTree(ctx context.Context, target gitRef) (string, error) {
	var out bytes.Buffer
	spec := commandSpec{name: "git", args: []string{"rev-parse", "--verify", target.ref + "^{tree}"}, dir: target.root}
	if err := target.run(ctx, spec, &out); err != nil {
		return "", fmt.Errorf("resolve the tree of %s: %w", target.ref, err)
	}
	return strings.TrimSpace(out.String()), nil
}
