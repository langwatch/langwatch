package app

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// The overlay is what a stack resolved to: hostnames, ports, database URLs and
// the seeded local identity. haven used to write it to a dotenv file at the
// workspace root so every process could load it. It no longer does. The file
// was a copy of state haven already holds, sitting in the checkout with
// database URLs and the local access tokens in it, going stale the moment a
// stack came down. Every process haven starts is handed these variables
// directly (see planChildren), and a person's own shell gets them from
// `haven env`.

// RetiredOverlayFiles are the dotenv overlays haven used to write. Both names
// are removed on `up`, and both stay in .gitignore, so a file left by an older
// haven — or by a checkout hook — can never shadow the injected environment.
var RetiredOverlayFiles = []string{".env.portless", ".env.haven"}

// retireOverlayFiles deletes any overlay a previous haven wrote in this
// worktree and says so once. Silent when there is nothing to remove, which is
// every run after the first. A file that cannot be removed is logged rather
// than fatal: it is stale data, and refusing to start a stack over it would be
// worse than the stale data itself.
func (o *Orchestrator) retireOverlayFiles(worktreeDir string) {
	if worktreeDir == "" {
		return
	}
	for _, name := range RetiredOverlayFiles {
		path := filepath.Join(worktreeDir, name)
		if _, err := os.Stat(path); err != nil {
			continue
		}
		if err := os.Remove(path); err != nil {
			o.logger().Warn("could not remove the retired overlay file",
				zap.String("path", path), zap.Error(err))
			continue
		}
		fmt.Printf("removed %s — haven's overlay is in-memory now; run `eval \"$(haven env)\"` to get it in a shell\n", name)
	}
}

// logger returns the orchestrator's logger, or a no-op when one was never
// injected (a test constructing the struct directly).
func (o *Orchestrator) logger() *zap.Logger {
	if o.log == nil {
		return zap.NewNop()
	}
	return o.log
}

// stackByWorktree finds the registered stack this checkout owns. Keyed on the
// worktree directory rather than the slug because that is the one identity a
// caller always has: `haven status` and `haven env` are run from a checkout,
// not from a slug.
func (o *Orchestrator) stackByWorktree(worktreeDir string) (domain.Stack, bool) {
	if worktreeDir == "" {
		return domain.Stack{}, false
	}
	stacks := o.store.Stacks()
	for i := range stacks {
		if stacks[i].WorktreeDir == worktreeDir {
			return stacks[i], true
		}
	}
	return domain.Stack{}, false
}

// StackEnv returns the resolved overlay for this worktree's registered stack —
// the exact KEY=VALUE set every supervised child is started with.
func (o *Orchestrator) StackEnv(p UpParams) ([]string, error) {
	if st, ok := o.stackByWorktree(p.WorktreeDir); ok {
		return st.OverlayEnv(), nil
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return nil, err
	}
	st, ok := o.stackBySlug(slug)
	if !ok {
		return nil, fmt.Errorf("no stack is registered for this worktree — run `haven up` here first")
	}
	return st.OverlayEnv(), nil
}

// Env prints this worktree's overlay for a shell to consume:
// `eval "$(haven env)"` puts a terminal in the same environment as the lanes
// haven supervises, which is what replaced loading a dotenv file. --json prints
// the same set as an object for anything that would rather parse it.
func (o *Orchestrator) Env(p UpParams, asJSON bool, reveal bool) error {
	env, err := o.StackEnv(p)
	if err != nil {
		return err
	}
	// Masked unless the caller asked for the values: `haven env` is pasted into
	// issues and read over a shoulder far more often than it is evaluated, and a
	// registry this checkout cannot read masks on the key's shape instead.
	var classes map[string]domain.SecretClass
	if !reveal {
		classes = domain.SecretClasses(p.WorktreeDir)
	}
	shown := func(key, value string) string {
		if reveal {
			return value
		}
		return domain.MaskEnvValue(classes, key, value)
	}
	if asJSON {
		masked := make(map[string]string, len(env))
		for key, value := range domain.EnvMap(env) {
			masked[key] = shown(key, value)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		return enc.Encode(masked)
	}
	for _, line := range env {
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		fmt.Printf("export %s=%s\n", key, shellSingleQuoted(shown(key, value)))
	}
	return nil
}

// overlayKeys lists the overlay's keys in a stable order, for the status
// report — which shows what the stack resolved to now that no file does.
func overlayKeys(env []string) []string {
	m := domain.EnvMap(env)
	keys := make([]string, 0, len(m))
	for k := range m {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	return keys
}
