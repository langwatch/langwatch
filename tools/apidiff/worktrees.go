package apidiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// The persistent worktrees follow visualdiff's (tools/visualdiff/worktrees.go):
// one per side under .apidiff/worktrees, moved to the run's commit rather than
// added fresh, so node_modules, generated files and dists stay warm and there
// is no worktree to remove at the end.
const (
	worktreesDir           = "worktrees"
	worktreeOwnerSuffix    = ".owner"
	worktreePreparedSuffix = ".prepared"
)

// sideCheckout is how one side's tree came to exist for this run.
type sideCheckout struct {
	side string
	dir  string
	// owned is a worktree added for this run alone, discarded at teardown.
	owned bool
	// persistent is .apidiff/worktrees/<side>, released at teardown.
	persistent bool
	// tree is the checked-out commit's tree: the key a prepare and the
	// inventories are cached on. Empty when the tree is not known.
	tree string
}

// toolDir is apidiff's own directory in the checkout it runs from.
func toolDir(root string) string {
	return filepath.Join(root, ".apidiff")
}

// persistentWorktree is where one side's reusable worktree lives.
func persistentWorktree(root, side string) string {
	return filepath.Join(toolDir(root), worktreesDir, side)
}

// worktreeHolder is the run a persistent worktree's owner file names.
type worktreeHolder struct {
	workRoot string
	pid      int
	keep     bool
}

func (holder worktreeHolder) render() string {
	return fmt.Sprintf("%s\n%d\n%t\n", holder.workRoot, holder.pid, holder.keep)
}

// readWorktreeHolder reads a persistent worktree's owner file.
func readWorktreeHolder(dir string) (worktreeHolder, bool) {
	content, err := os.ReadFile(dir + worktreeOwnerSuffix) // #nosec G304 -- a file under the tool's own .apidiff directory.
	if err != nil {
		return worktreeHolder{}, false
	}
	lines := strings.Split(strings.TrimSpace(string(content)), "\n")
	holder := worktreeHolder{workRoot: strings.TrimSpace(lines[0])}
	if len(lines) > 1 {
		holder.pid, _ = strconv.Atoi(strings.TrimSpace(lines[1]))
	}
	if len(lines) > 2 {
		holder.keep = strings.TrimSpace(lines[2]) == "true"
	}
	return holder, holder.workRoot != ""
}

// holdsAgainst reports a holder other than this run that still needs the
// worktree: its work root exists and it is alive or was kept.
func (holder worktreeHolder) holdsAgainst(workRoot string, alive func(int) bool) bool {
	if holder.workRoot == workRoot {
		return false
	}
	if _, err := os.Stat(holder.workRoot); err != nil {
		return false
	}
	return holder.keep || (holder.pid > 0 && alive(holder.pid))
}

// worktreeClaim is one run asking for one side's persistent worktree.
type worktreeClaim struct {
	root  string
	side  string
	me    worktreeHolder
	alive func(pid int) bool
}

// claim decides where a side checks out: its persistent worktree, unless
// another live or kept run holds it, when this run falls back to a worktree
// of its own under the work root that teardown discards.
func (claim worktreeClaim) claim() (string, bool, error) {
	dir := persistentWorktree(claim.root, claim.side)
	if holder, ok := readWorktreeHolder(dir); ok && holder.holdsAgainst(claim.me.workRoot, claim.alive) {
		return filepath.Join(claim.me.workRoot, claim.side), false, nil
	}
	if err := os.MkdirAll(filepath.Dir(dir), 0o750); err != nil {
		return "", false, err
	}
	if err := os.WriteFile(dir+worktreeOwnerSuffix, []byte(claim.me.render()), 0o600); err != nil {
		return "", false, err
	}
	return dir, true, nil
}

// releaseWorktree lets the next run take a persistent worktree this run held.
func releaseWorktree(dir, workRoot string) {
	if holder, ok := readWorktreeHolder(dir); ok && holder.workRoot == workRoot {
		_ = os.Remove(dir + worktreeOwnerSuffix)
	}
}

// processAlive reports a pid that still names a running process.
func processAlive(pid int) bool {
	err := syscall.Kill(pid, 0)
	return err == nil || errors.Is(err, syscall.EPERM)
}

// persistentCheckoutArgs move a persistent worktree to commit, adding it the
// first time. --force discards what a previous prepare wrote over tracked
// files; ignored files (node_modules, dists) are what the reuse keeps.
func persistentCheckoutArgs(dir, commit string, exists bool) [][]string {
	if exists {
		return [][]string{{"-C", dir, "checkout", "--detach", "--force", commit}}
	}
	return [][]string{{"worktree", "prune"}, {"worktree", "add", "--force", "--detach", dir, commit}}
}

// isWorktree reports a directory git already checked a worktree out into.
func isWorktree(dir string) bool {
	_, err := os.Stat(filepath.Join(dir, ".git"))
	return err == nil
}

// prepareKey is what a prepare's output depends on: the layout, the steps and
// the commit's whole tree, spelled as visualdiff's PrepareKey spells it.
func prepareKey(layout havenrun.Layout, tree string, steps []havenrun.PrepareStep) string {
	digest := sha256.New()
	fmt.Fprintf(digest, "layout=%s\ntree=%s\n", layout, tree)
	for _, step := range steps {
		fmt.Fprintf(digest, "%s %s\n", step.Name, strings.Join(step.Args, " "))
	}
	return hex.EncodeToString(digest.Sum(nil))
}

// preparedKey is the key a persistent worktree's last finished prepare recorded.
func preparedKey(dir string) string {
	recorded, err := os.ReadFile(dir + worktreePreparedSuffix) // #nosec G304 -- a file under the tool's own .apidiff directory.
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

// gitOutput runs one git command in dir and answers its trimmed output.
func (state *bootState) gitOutput(ctx context.Context, dir string, args ...string) (string, error) {
	var out bytes.Buffer
	if err := state.run(ctx, commandSpec{name: "git", args: args, dir: dir}, &out); err != nil {
		return "", fmt.Errorf("git %s: %w", strings.Join(args, " "), err)
	}
	return strings.TrimSpace(out.String()), nil
}

// checkOut gives one side its tree at ref: the persistent worktree moved to
// the commit ref names now, a worktree of its own when another run holds that
// one, or, with -reuse-worktrees, the <work-root>/<side> already there.
func (state *bootState) checkOut(ctx context.Context, side, ref string) (sideCheckout, error) {
	if state.cfg.ReuseWorktrees {
		dir := filepath.Join(state.workRoot, side)
		if _, err := os.Stat(dir); err != nil {
			return sideCheckout{}, fmt.Errorf("-reuse-worktrees but %s does not exist", dir)
		}
		state.logf("reusing worktree %s", dir)
		return state.recordCheckout(sideCheckout{side: side, dir: dir}), nil
	}
	commit, err := state.gitOutput(ctx, state.cfg.BranchDir, "rev-parse", "--verify", ref+"^{commit}")
	if err != nil || commit == "" {
		return sideCheckout{}, fmt.Errorf("resolve %s: %w", ref, err)
	}
	me := worktreeHolder{workRoot: state.workRoot, pid: os.Getpid(), keep: state.cfg.Keep}
	dir, persistent, err := worktreeClaim{root: state.cfg.BranchDir, side: side, me: me, alive: processAlive}.claim()
	if err != nil {
		return sideCheckout{}, fmt.Errorf("claim the %s worktree: %w", side, err)
	}
	checkout := state.recordCheckout(sideCheckout{side: side, dir: dir, owned: !persistent, persistent: persistent})
	if err := state.moveTo(ctx, checkout, commit); err != nil {
		return checkout, err
	}
	removeOverlay(dir)
	if tree, err := state.gitOutput(ctx, dir, "rev-parse", "HEAD^{tree}"); err == nil {
		checkout.tree = tree
		state.recordCheckout(checkout)
	}
	return checkout, nil
}

// moveTo puts a claimed checkout at commit: a persistent worktree in place, a
// fallback one by adding it fresh.
func (state *bootState) moveTo(ctx context.Context, checkout sideCheckout, commit string) error {
	commands := [][]string{worktreeAddArgs(checkout.dir, commit)}
	if checkout.persistent {
		commands = persistentCheckoutArgs(checkout.dir, commit, isWorktree(checkout.dir))
	} else {
		state.logf("%s: another live run holds the persistent worktree, adding %s for this run alone", checkout.side, checkout.dir)
	}
	for _, args := range commands {
		state.logf("git %s", strings.Join(args, " "))
		if err := state.runHost(ctx, "git", args...); err != nil {
			return fmt.Errorf("check out %s at %s: %w", checkout.side, commit, err)
		}
	}
	return nil
}

// recordCheckout files a side's checkout on the state, replacing an earlier
// record of the same side, so teardown finds it however far checkOut got.
func (state *bootState) recordCheckout(checkout sideCheckout) sideCheckout {
	state.checkoutsMu.Lock()
	defer state.checkoutsMu.Unlock()
	for index, existing := range state.checkouts {
		if existing.side == checkout.side {
			state.checkouts[index] = checkout
			return checkout
		}
	}
	state.checkouts = append(state.checkouts, checkout)
	return checkout
}

// checkoutOf is the checkout recorded for a side's tree, if the run made one.
func (state *bootState) checkoutOf(dir string) (sideCheckout, bool) {
	state.checkoutsMu.Lock()
	defer state.checkoutsMu.Unlock()
	for _, checkout := range state.checkouts {
		if checkout.dir == dir {
			return checkout, true
		}
	}
	return sideCheckout{}, false
}

// removeOverlay deletes the monolith env overlay a run wrote into a tree. Its
// env-load applies the file with override:true, so one left behind would aim
// the next stack started in that directory at this run's dropped database.
func removeOverlay(dir string) {
	_ = os.Remove(filepath.Join(dir, overlayEnvFile))
}
