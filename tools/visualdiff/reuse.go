package visualdiff

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/havenrun"
)

// A persistent worktree skips a prepare step whose inputs are unchanged since
// it last finished there. Inputs are git object ids read from HEAD, never
// mtimes, and anything not known to be irrelevant counts: when unsure, rebuild.

// lockInputs are what `pnpm install --frozen-lockfile` writes node_modules from.
var lockInputs = []string{"pnpm-lock.yaml", "pnpm-workspace.yaml", ".npmrc", ".pnpmfile.cjs", "patches"}

// notCodeInputs are the top-level entries no generated file or UI build reads:
// Go, docs, specs, tooling, infrastructure. services is kept for codeServices.
var notCodeInputs = map[string]bool{
	".agents": true, ".claude": true, ".github": true, ".githooks": true, ".rtk": true, "charts": true, "cmd": true,
	"docs": true, "go.mod": true, "go.sum": true, "go.work": true, "go.work.sum": true, "infra": true,
	"pkg": true, "pyproject.toml": true, "services": true, "specs": true, "tools": true, "uv.lock": true, "vendor": true,
}

// codeServices are the services whose files a TypeScript build does read.
var codeServices = []string{"services/langevals/ts-integration", "services/langyworker"}

// ensureBuiltTargets are where `pnpm run ensure:built` takes its lock; a
// lock a killed build left makes every later prepare wait 180s per target.
var ensureBuiltTargets = []string{"sdks/typescript", "mcp/typescript", "packages/ksuid", "packages/mail"}

// gitTree is a worktree's git, asked through run.
type gitTree struct {
	run runner
	dir string
}

// treeEntries lists `git ls-tree HEAD [paths]` in dir as "sha path" lines.
func treeEntries(ctx context.Context, tree gitTree, paths ...string) ([]string, error) {
	dir := tree.dir
	var out bytes.Buffer
	args := append([]string{"ls-tree", "HEAD", "--"}, paths...)
	if err := tree.run(ctx, commandSpec{name: "git", args: args, dir: dir}, &out); err != nil {
		return nil, err
	}
	var entries []string
	for _, line := range strings.Split(strings.TrimSpace(out.String()), "\n") {
		meta, path, found := strings.Cut(line, "\t")
		fields := strings.Fields(meta)
		if found && len(fields) == 3 {
			entries = append(entries, fields[2]+" "+path)
		}
	}
	if len(entries) == 0 {
		return nil, fmt.Errorf("git ls-tree HEAD in %s listed nothing", dir)
	}
	return entries, nil
}

// CodeEntries keeps the tree entries a build can read: every top-level entry
// but notCodeInputs and Markdown, plus the codeServices entries.
func CodeEntries(top, services []string) []string {
	var kept []string
	for _, entry := range top {
		_, path, _ := strings.Cut(entry, " ")
		if !notCodeInputs[path] && !strings.HasSuffix(path, ".md") {
			kept = append(kept, entry)
		}
	}
	return append(kept, services...)
}

// codeKey names a worktree's code inputs, or "" when they cannot be read.
func codeKey(ctx context.Context, run runner, dir string) string {
	top, err := treeEntries(ctx, gitTree{run: run, dir: dir})
	if err != nil {
		return ""
	}
	services, _ := treeEntries(ctx, gitTree{run: run, dir: dir}, codeServices...)
	return digestLines(CodeEntries(top, services))
}

// lockKey names a worktree's install inputs, or "" when they cannot be read.
func lockKey(ctx context.Context, run runner, dir string) string {
	entries, err := treeEntries(ctx, gitTree{run: run, dir: dir}, lockInputs...)
	if err != nil {
		return ""
	}
	return digestLines(entries)
}

func digestLines(lines []string) string {
	sum := sha256.Sum256([]byte(strings.Join(lines, "\n")))
	return hex.EncodeToString(sum[:])
}

// stepKey is what one prepare step's output depends on, or "" to always run
// it: an install on the lockfile, ensure-built never (it checks itself), any
// other step on the code.
func stepKey(ctx context.Context, run runner, step prepareStep) string {
	stack, spec := step.stack, step.spec
	switch {
	case !stack.Persistent || isEnsureBuilt(spec):
		return ""
	case prepareStepName(spec) == "install":
		return keyed(stack.Layout, spec, lockKey(ctx, run, stack.Dir))
	default:
		return keyed(stack.Layout, spec, codeKey(ctx, run, stack.Dir))
	}
}

// prepareStep is one prepare command, numbered in its stack's prepare list.
type prepareStep struct {
	stack Stack
	index int
	spec  commandSpec
}

// prepared reports a step this worktree last finished with this key, whose
// output is still there.
func prepared(step prepareStep, key string) bool {
	stack := step.stack
	if key == "" || readStepKey(stack.Dir, step.index) != key {
		return false
	}
	return havenrun.PreparedOutputsExist(stack.Dir, havenrun.Layout(stack.Layout))
}

func keyed(layout Layout, spec commandSpec, inputs string) string {
	if inputs == "" {
		return ""
	}
	return PrepareKey(layout, inputs, []commandSpec{spec})
}

func isEnsureBuilt(spec commandSpec) bool {
	return len(spec.args) == 2 && spec.args[0] == "run" && spec.args[1] == "ensure:built"
}

// stepFile is where a persistent worktree records step index's last key.
func stepFile(dir string, index int) string {
	return dir + worktreePreparedSuffix + "." + strconv.Itoa(index)
}

func readStepKey(dir string, index int) string {
	recorded, err := os.ReadFile(stepFile(dir, index)) // #nosec G304 -- a file under the tool's own .visualdiff directory.
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(recorded))
}

// writeStepKey records a finished step's key, or forgets it with "".
func writeStepKey(dir string, index int, key string) error {
	if key == "" {
		if err := os.Remove(stepFile(dir, index)); err != nil && !os.IsNotExist(err) {
			return err
		}
		return nil
	}
	return os.WriteFile(stepFile(dir, index), []byte(key+"\n"), 0o600)
}

// clearEnsureBuiltLocks removes the build locks a killed prepare left. Only
// ever before this run's stack is up, so no build of this worktree holds one.
func clearEnsureBuiltLocks(dir string) []string {
	var cleared []string
	for _, target := range ensureBuiltTargets {
		lock := filepath.Join(dir, target, "node_modules", ".ensure-built.lock")
		if dirExists(lock) && os.RemoveAll(lock) == nil {
			cleared = append(cleared, target)
		}
	}
	return cleared
}
