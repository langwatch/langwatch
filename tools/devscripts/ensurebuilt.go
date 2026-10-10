package devscripts

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"syscall"
	"time"
)

type buildTarget struct {
	name, dir, entry string
	needs            []string
	// inputs are paths outside dir the build reads, besides its workspace deps.
	inputs []string
}

// sharedInputs are nx.json's sharedGlobals, which every build reads.
var sharedInputs = []string{"tsconfig.base.json", "tsconfig.shared.json", "pnpm-workspace.yaml"}

// The packages that resolve a built `dist`; ksuid builds before mail. The SDK's
// inputs mirror its build inputs in nx.json, and a test holds them together.
var buildTargets = []buildTarget{
	{name: "langwatch", dir: "sdks/typescript", entry: "dist/index.mjs", inputs: []string{
		"feature-map.json",
		"skills",
		"services/langevals/ts-integration/evaluators.generated.ts",
		"modules/evaluator/contract/src/evaluators.native.ts",
		"modules/model-provider/contract/src/catalog/model-catalog.json",
		"modules/scenario/contract/src/evaluator-attachments.ts",
		"modules/scenario/contract/src/suite-fields.ts",
		"modules/trace/contract/src/trace-format.schemas.ts",
		"packages/redaction/src",
	}},
	{name: "@langwatch/mcp-server", dir: "mcp/typescript", entry: "dist/index.js"},
	{name: "@langwatch/ksuid", dir: "packages/ksuid", entry: "dist/index.d.ts"},
	{name: "@langwatch/mail", dir: "packages/mail", entry: "dist/index.js", needs: []string{"@langwatch/ksuid"}},
}

const (
	staleLock    = 10 * time.Minute
	lockPolls    = 900
	lockInterval = 200 * time.Millisecond
	stampName    = ".ensure-built.stamp"
)

// skippedNames are never build inputs: installs, outputs and caches.
var skippedNames = map[string]bool{
	"node_modules": true, "dist": true, ".tsup": true, ".turbo": true, ".nx": true, ".DS_Store": true,
}

func selectTargets(requested []string) ([]buildTarget, []string) {
	wanted := map[string]bool{}
	var unknown []string
	for _, name := range requested {
		wanted[name] = true
		if !wantNeeds(wanted, name) {
			unknown = append(unknown, name)
		}
	}
	if len(requested) == 0 {
		return buildTargets, nil
	}
	var selected []buildTarget
	for _, target := range buildTargets {
		if wanted[target.name] {
			selected = append(selected, target)
		}
	}
	return selected, unknown
}

// wantNeeds marks what every target called name needs, and reports whether
// any target has that name.
func wantNeeds(wanted map[string]bool, name string) bool {
	found := false
	for _, target := range buildTargets {
		if target.name != name {
			continue
		}
		found = true
		for _, need := range target.needs {
			wanted[need] = true
		}
	}
	return found
}

// inputPaths lists every path a target's build reads: its package, the shared
// globals, its declared inputs, its needs and its workspace dependencies
// (resolved through its node_modules links, as Node resolves them).
func inputPaths(root string, target buildTarget) []string {
	dir := filepath.Join(root, target.dir)
	paths := []string{dir}
	for _, input := range slices.Concat(sharedInputs, target.inputs) {
		paths = append(paths, filepath.Join(root, input))
	}
	for _, other := range buildTargets {
		if slices.Contains(target.needs, other.name) {
			paths = append(paths, filepath.Join(root, other.dir))
		}
	}
	member, ok, err := readWorkspaceMember(dir)
	if err != nil || !ok {
		return paths
	}
	for _, name := range slices.Concat(member.Dependencies, member.DevDependencies) {
		if real, err := filepath.EvalSymlinks(filepath.Join(dir, "node_modules", name)); err == nil {
			paths = append(paths, real)
		}
	}
	return paths
}

// inputHash hashes the path and content of every input file, so a touch that
// changes nothing never forces a build.
func inputHash(root string, target buildTarget) (string, error) {
	sum := sha256.New()
	for _, path := range inputPaths(root, target) {
		err := filepath.WalkDir(path, func(file string, entry fs.DirEntry, err error) error {
			if errors.Is(err, fs.ErrNotExist) {
				return nil
			}
			if err != nil {
				return err
			}
			if skippedNames[entry.Name()] && file != path {
				if entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if !entry.Type().IsRegular() {
				return nil
			}
			data, err := os.ReadFile(file)
			if err != nil {
				return err
			}
			rel, _ := filepath.Rel(root, file)
			fmt.Fprintf(sum, "%s\x00%d\x00", rel, len(data))
			sum.Write(data)
			return nil
		})
		if err != nil {
			return "", err
		}
	}
	return hex.EncodeToString(sum.Sum(nil)), nil
}

// stamp is what a build leaves: the input hash it was built from and the
// built entry's mtime, so a dist rebuilt by anything else counts as stale.
func stamp(root string, target buildTarget, hash string) string {
	info, err := os.Stat(filepath.Join(root, target.dir, target.entry))
	if err != nil {
		return ""
	}
	return hash + " " + strconv.FormatInt(info.ModTime().UnixNano(), 10)
}

func stampPath(root string, target buildTarget) string {
	return filepath.Join(root, target.dir, "node_modules", stampName)
}

// staleTargets returns each target whose dist is missing or was not built from
// its inputs as they are now, with that input hash.
func staleTargets(root string, selected []buildTarget) ([]buildTarget, []string, error) {
	var stale []buildTarget
	var hashes []string
	for _, target := range selected {
		hash, err := inputHash(root, target)
		if err != nil {
			return nil, nil, err
		}
		recorded, _ := os.ReadFile(stampPath(root, target))
		if current := stamp(root, target, hash); current == "" || current != string(recorded) {
			stale, hashes = append(stale, target), append(hashes, hash)
		}
	}
	return stale, hashes, nil
}

// nxEnv is the root scripts' Nx prefix: no .env loaded into tasks, no colour.
var nxEnv = []string{"FORCE_COLOR=0", "NX_LOAD_DOT_ENV_FILES=false"}

// nxBuildArgs runs the cached Nx build: a miss builds, a hit restores what
// another worktree built. Only a stale stamp gets here, so the graph cost is paid on a miss.
func nxBuildArgs(name string) []string {
	return []string{"exec", "nx", "run", name + ":build", "--outputStyle=static"}
}

// buildStale builds each stale target through its cached Nx build, in target
// order, and stamps it with the hash taken before the build began.
func buildStale(root string, selected []buildTarget, stderr io.Writer) error {
	stale, hashes, err := staleTargets(root, selected)
	if err != nil {
		return err
	}
	for i, target := range stale {
		start := time.Now()
		fmt.Fprintf(stderr, "ensure-built: building %s (%s missing or stale)\n", target.name, target.entry)
		args := nxBuildArgs(target.name)
		cmd := exec.CommandContext(context.Background(), "pnpm", args...)
		cmd.Dir, cmd.Stdout, cmd.Stderr = root, os.Stdout, os.Stderr
		cmd.Env = append(os.Environ(), nxEnv...)
		if err := cmd.Run(); err != nil {
			return fmt.Errorf("pnpm %s: %w", strings.Join(args, " "), err)
		}
		path := stampPath(root, target)
		_ = os.MkdirAll(filepath.Dir(path), 0o755)
		if err := os.WriteFile(path, []byte(stamp(root, target, hashes[i])), 0o644); err != nil {
			fmt.Fprintf(stderr, "ensure-built: could not stamp %s: %v\n", target.name, err)
		}
		fmt.Fprintf(stderr, "ensure-built: built %s in %s\n", target.name, time.Since(start).Round(100*time.Millisecond))
	}
	return nil
}

// lockWorkspace waits for a holder to finish, clearing a lock a killed run left,
// and returns the release; a lock it never took is left alone.
func lockWorkspace(lock string) func() {
	_ = os.MkdirAll(filepath.Dir(lock), 0o755)
	for i := 0; i < lockPolls; i++ {
		clearStaleLock(lock)
		if takeLock(lock) {
			return func() { _ = os.RemoveAll(lock) }
		}
		time.Sleep(lockInterval)
	}
	return func() {}
}

// takeLock creates the lock directory and records this process as its holder.
func takeLock(lock string) bool {
	if os.Mkdir(lock, 0o755) != nil {
		return false
	}
	_ = os.WriteFile(filepath.Join(lock, "pid"), []byte(strconv.Itoa(os.Getpid())), 0o644)
	return true
}

// clearStaleLock removes a lock older than staleLock or whose recorded holder
// has exited, so a killed build never stalls the next one.
func clearStaleLock(lock string) {
	info, err := os.Stat(lock)
	if err != nil {
		return
	}
	if time.Since(info.ModTime()) > staleLock || !holderAlive(lock) {
		_ = os.RemoveAll(lock)
	}
}

// holderAlive reports whether the lock's recorded holder still runs; a lock
// with no pid yet (just created) counts as held.
func holderAlive(lock string) bool {
	raw, err := os.ReadFile(filepath.Join(lock, "pid"))
	if err != nil {
		return true
	}
	pid, err := strconv.Atoi(strings.TrimSpace(string(raw)))
	if err != nil {
		return false
	}
	proc, err := os.FindProcess(pid)
	return err == nil && proc.Signal(syscall.Signal(0)) == nil
}

// EnsureBuilt builds each requested (default all) dist whose inputs changed
// since its last build. The fresh check takes no lock; a build re-checks under
// the workspace lock, so parallel predev hooks build each package once.
func EnsureBuilt(root string, requested []string, stderr io.Writer) int {
	selected, unknown := selectTargets(requested)
	if len(unknown) > 0 {
		fmt.Fprintf(stderr, "ensure-built: no such target: %s\n", strings.Join(slices.Compact(unknown), ", "))
		return 1
	}
	if stale, _, err := staleTargets(root, selected); err == nil && len(stale) == 0 {
		return 0
	}
	defer lockWorkspace(filepath.Join(root, "node_modules", ".ensure-built.lock"))()
	if err := buildStale(root, selected, stderr); err != nil {
		fmt.Fprintln(stderr, "ensure-built:", err)
		return 1
	}
	return 0
}
