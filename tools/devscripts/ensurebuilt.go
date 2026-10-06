package devscripts

import (
	"context"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"slices"
	"strings"
	"time"
)

type buildTarget struct {
	name, dir, entry string
	needs            []string
}

// The packages that resolve a built `dist`; ksuid builds before mail.
var buildTargets = []buildTarget{
	{name: "langwatch", dir: "sdks/typescript", entry: "dist/index.mjs"},
	{name: "@langwatch/mcp-server", dir: "mcp/typescript", entry: "dist/index.js"},
	{name: "@langwatch/ksuid", dir: "packages/ksuid", entry: "dist/index.d.ts"},
	{name: "@langwatch/mail", dir: "packages/mail", entry: "dist/index.js", needs: []string{"@langwatch/ksuid"}},
}

const (
	staleLock    = 10 * time.Minute
	lockPolls    = 900
	lockInterval = 200 * time.Millisecond
)

func mtime(path string) time.Time {
	info, err := os.Stat(path)
	if err != nil {
		return time.Time{}
	}
	return info.ModTime()
}

func newestUnder(dir string) (time.Time, error) {
	var newest time.Time
	err := filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.Type().IsRegular() {
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return nil
		}
		if info.ModTime().After(newest) {
			newest = info.ModTime()
		}
		return nil
	})
	return newest, err
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

func buildOne(root string, target buildTarget, stderr io.Writer) error {
	dir := filepath.Join(root, target.dir)
	entry := filepath.Join(dir, target.entry)
	newest, err := newestUnder(filepath.Join(dir, "src"))
	if err != nil {
		return err
	}
	if mtime(entry).After(newest) {
		return nil
	}
	lock := filepath.Join(dir, "node_modules", ".ensure-built.lock")
	if !acquireBuildLock(lock) {
		return nil
	}
	defer os.RemoveAll(lock)
	fmt.Fprintf(stderr, "ensure-built: building %s (%s missing or stale)\n", target.name, target.entry)
	args := []string{"--filter", target.name, "build"}
	cmd := exec.CommandContext(context.Background(), "pnpm", args...)
	cmd.Dir, cmd.Stdout, cmd.Stderr = root, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("pnpm %s: %w", strings.Join(args, " "), err)
	}
	stampEntry(entry, target, stderr)
	return nil
}

// acquireBuildLock takes the build lock, clearing a stale one first. When
// another build holds it, it waits for that build and reports false.
func acquireBuildLock(lock string) bool {
	if info, err := os.Stat(lock); err == nil && time.Since(info.ModTime()) > staleLock {
		_ = os.RemoveAll(lock)
	}
	if os.Mkdir(lock, 0o755) == nil {
		return true
	}
	for i := 0; i < lockPolls && exists(lock); i++ {
		time.Sleep(lockInterval)
	}
	return false
}

// stampEntry touches the built entry so its mtime passes the source's newest.
func stampEntry(entry string, target buildTarget, stderr io.Writer) {
	now := time.Now()
	err := os.Chtimes(entry, now, now)
	if err == nil {
		return
	}
	reason := err.Error()
	if errors.Is(err, fs.ErrNotExist) {
		reason = "ENOENT: no such file or directory, utime '" + entry + "'"
	}
	fmt.Fprintf(stderr, "ensure-built: could not stamp %s: %s\n", target.entry, reason)
}

// buildWithNx hands the whole set to Nx, which hashes every input a build reads
// (the SDK copies files from outside its package, which no mtime of src/ sees),
// orders ksuid before mail through ^build, and restores a build any checkout
// already made (ADR-150). Parallel predev hooks queue on one workspace lock.
func buildWithNx(root string, selected []buildTarget, stderr io.Writer) int {
	names := make([]string, 0, len(selected))
	for _, target := range selected {
		names = append(names, target.name)
	}
	defer lockWorkspace(filepath.Join(root, "node_modules", ".ensure-built.lock"))()
	args := []string{"exec", "nx", "run-many", "-t", "build", "-p", strings.Join(names, ","), "--outputStyle=static"}
	cmd := exec.CommandContext(context.Background(), "pnpm", args...)
	cmd.Dir, cmd.Stdout, cmd.Stderr = root, os.Stdout, os.Stderr
	if err := cmd.Run(); err != nil {
		fmt.Fprintf(stderr, "ensure-built: pnpm %s: %v\n", strings.Join(args, " "), err)
		return 1
	}
	return 0
}

// lockWorkspace waits for a holder to finish, clearing a lock a killed run left,
// and returns the release; a lock it never took is left alone.
func lockWorkspace(lock string) func() {
	if info, err := os.Stat(lock); err == nil && time.Since(info.ModTime()) > staleLock {
		_ = os.RemoveAll(lock)
	}
	for i := 0; i < lockPolls; i++ {
		if os.Mkdir(lock, 0o755) == nil {
			return func() { _ = os.RemoveAll(lock) }
		}
		time.Sleep(lockInterval)
	}
	return func() {}
}

// EnsureBuilt builds each requested (default all) dist through Nx when the
// workspace has it; without Nx, each that is missing or older than its sources,
// one builder at a time per package.
func EnsureBuilt(root string, requested []string, stderr io.Writer) int {
	selected, unknown := selectTargets(requested)
	if len(unknown) > 0 {
		fmt.Fprintf(stderr, "ensure-built: no such target: %s\n", strings.Join(slices.Compact(unknown), ", "))
		return 1
	}
	if exists(filepath.Join(root, "node_modules", ".bin", "nx")) {
		return buildWithNx(root, selected, stderr)
	}
	for _, target := range selected {
		if err := buildOne(root, target, stderr); err != nil {
			fmt.Fprintln(stderr, "ensure-built:", err)
			return 1
		}
	}
	return 0
}
