package app

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// ensureDeps installs node dependencies when the lockfile is newer than the
// last install — pnpm stamps node_modules/.modules.yaml, so "lockfile newer
// than the stamp" (or no stamp at all) means a checkout or branch switch left
// node_modules stale. Part of up's automatic preparation: a failed install
// fails the up, because every service would otherwise fail later and worse.
//
// Takes the WORKSPACE ROOT. Since ADR-076 the repo is a single
// pnpm workspace: the lockfile and node_modules live at the root and langwatch/
// has neither. Pointed at langwatch/ this silently did nothing at all —
// depsStale found no lockfile there and read that as "nothing to install", so
// a fresh worktree started every service against absent dependencies.
//
// WithLifecycleScripts must be false whenever the checkout's package.json is not
// this repo's own — a play sandbox of a fork PR, most of all. This repo has a
// postinstall, and a fork controls package scripts, so a plain install executes
// fork-authored code with the developer's environment and credentials before a
// single service starts. `haven pr` has always guarded this (see installDeps in
// pr.go); play must guard it the same way.
func (o *Orchestrator) ensureDeps(ctx context.Context, dir string, install depsInstall) error {
	// Resolve the workspace root ourselves rather than trusting the caller to
	// know the layout. The regression this guards against: both call sites
	// used to pass langwatch/, depsStale found no lockfile there, and haven
	// silently installed nothing. A caller-side fix leaves the same mistake
	// open to the next caller; resolving here makes the class unreachable.
	rootDir, found := findWorkspaceRoot(dir)
	if !found {
		// Pre-ADR-076, "no lockfile" quietly meant "nothing to install" — the
		// exact misread that let `haven up` start every service against absent
		// dependencies. The repo tracks its lockfile, so not finding one
		// anywhere up the tree means a broken or truncated checkout, and the
		// only helpful thing to do is say so before the services fail worse.
		return fmt.Errorf("no pnpm-lock.yaml found at or above %s — is this a complete checkout?", dir)
	}
	if !depsStale(rootDir) {
		return nil
	}
	shell := "pnpm --silent install"
	if !install.WithLifecycleScripts {
		shell = "pnpm --silent install --ignore-scripts"
		fmt.Println("  dependencies: installing with --ignore-scripts (untrusted checkout: its lifecycle scripts will not run)…")
	} else {
		fmt.Println("  dependencies: lockfile changed since the last install — running pnpm install…")
	}
	if err := o.sup.RunOnce(ctx, "deps", rootDir, shell, install.Env); err != nil {
		return fmt.Errorf("pnpm install failed: %w", err)
	}
	return nil
}

// depsInstall is how an install runs. Env carries the stack's Nx isolation
// (nxEnv), so the install is one more lane of an untrusted stack, never the one
// that reaches the shared cache.
type depsInstall struct {
	WithLifecycleScripts bool
	Env                  []string
}

// findWorkspaceRoot walks up from dir to the nearest directory holding a
// pnpm-lock.yaml — the workspace root, the only place the lockfile and
// node_modules exist since ADR-076. Handed the root itself it returns it
// unchanged; handed a member (langwatch/, a sandbox's langwatch/) it climbs
// out. found=false means no lockfile exists anywhere up the tree.
func findWorkspaceRoot(dir string) (root string, found bool) {
	for d := dir; ; {
		if _, err := os.Stat(filepath.Join(d, "pnpm-lock.yaml")); err == nil {
			return d, true
		}
		parent := filepath.Dir(d)
		if parent == d {
			return dir, false
		}
		d = parent
	}
}

// depsStale reports whether rootDir's installed modules predate its lockfile.
// No lockfile means nothing to install; no stamp means never installed.
//
// rootDir is the workspace root — the only place either file exists since
// ADR-076.
func depsStale(rootDir string) bool {
	lock, err := os.Stat(filepath.Join(rootDir, "pnpm-lock.yaml"))
	if err != nil {
		return false
	}
	stamp, err := os.Stat(filepath.Join(rootDir, "node_modules", ".modules.yaml"))
	if err != nil {
		return true
	}
	return lock.ModTime().After(stamp.ModTime())
}

// nxPrivateDir is where an untrusted stack's Nx cache and workspace data live:
// under haven's own home, one directory per stack, removed with the stack.
func (o *Orchestrator) nxPrivateDir(slug string) string {
	return filepath.Join(o.cfg.Home, "nx-untrusted", slug)
}

// nxEnv is only the Nx lines of a stack's overlay: what the install lane, which
// needs no service wiring, still has to carry for an untrusted checkout.
func nxEnv(st domain.Stack) []string {
	var out []string
	for _, kv := range st.OverlayEnv() {
		if strings.HasPrefix(kv, "NX_") {
			out = append(out, kv)
		}
	}
	return out
}

// removeNxPrivateDir deletes an untrusted stack's private Nx cache with it.
func (o *Orchestrator) removeNxPrivateDir(slug string) {
	if slug != "" && o.cfg.Home != "" {
		_ = os.RemoveAll(o.nxPrivateDir(slug))
	}
}
