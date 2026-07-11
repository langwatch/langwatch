// Package fileregistry implements app.Store on the filesystem: the cross-worktree
// registry + daemon record under the thuishaven home dir, plus the two
// worktree-local files (the slug cache and the .env.portless overlay).
package fileregistry

import (
	"encoding/json"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/app"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Store is the filesystem-backed implementation of app.Store.
type Store struct {
	home string
}

// New builds a Store rooted at the thuishaven home dir (~/.langwatch/portless).
func New(home string) *Store { return &Store{home: home} }

func (s *Store) registryDir() string          { return filepath.Join(s.home, "registry") }
func (s *Store) stackPath(slug string) string { return filepath.Join(s.registryDir(), slug+".json") }
func (s *Store) daemonPath() string           { return filepath.Join(s.home, "haven.json") }

// SaveStack persists one stack's registry entry. Mode 0o600: the entry carries
// LocalAPIKey, so it must not be world-readable.
func (s *Store) SaveStack(st domain.Stack) error {
	if err := os.MkdirAll(s.registryDir(), 0o755); err != nil {
		return err
	}
	b, err := json.MarshalIndent(st, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.stackPath(st.Slug), append(b, '\n'), 0o600)
}

// RemoveStack drops a stack's registry entry.
func (s *Store) RemoveStack(slug string) { _ = os.Remove(s.stackPath(slug)) }

// Stacks loads every registry entry, newest heartbeat first.
func (s *Store) Stacks() []domain.Stack {
	var out []domain.Stack
	entries, err := os.ReadDir(s.registryDir())
	if err != nil {
		return out
	}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.registryDir(), e.Name()))
		if err != nil {
			continue
		}
		var st domain.Stack
		if json.Unmarshal(b, &st) == nil {
			out = append(out, st)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].UpdatedAt.After(out[j].UpdatedAt) })
	return out
}

// TakenSlugs is the set of currently-registered slugs (for collision avoidance).
func (s *Store) TakenSlugs() map[string]bool {
	taken := map[string]bool{}
	for _, st := range s.Stacks() {
		taken[st.Slug] = true
	}
	return taken
}

// ReadSlugCache reads the worktree-local .langwatch-slug.
func (s *Store) ReadSlugCache(worktreeDir string) (string, bool) {
	b, err := os.ReadFile(filepath.Join(worktreeDir, ".langwatch-slug"))
	if err != nil {
		return "", false
	}
	return strings.TrimSpace(string(b)), true
}

// WriteSlugCache pins the derived slug for a worktree.
func (s *Store) WriteSlugCache(worktreeDir, slug string) error {
	return os.WriteFile(filepath.Join(worktreeDir, ".langwatch-slug"), []byte(slug+"\n"), 0o644)
}

// WriteOverlay writes langwatch/.env.portless. Mode 0o600: it carries
// LANGWATCH_API_KEY, so it must not be world-readable.
func (s *Store) WriteOverlay(lwDir string, st domain.Stack) error {
	return os.WriteFile(filepath.Join(lwDir, ".env.portless"), []byte(st.OverlayFile()), 0o600)
}

// hmrGatePath is the worktree-local marker the Vite HMR-gate plugin reads.
func (s *Store) hmrGatePath(lwDir string) string {
	return filepath.Join(lwDir, ".haven-hmr-gate")
}

// WriteHMRGate writes the gate expiry (unix-ms) so Vite defers HMR until then.
func (s *Store) WriteHMRGate(lwDir string, expiryUnixMs int64) error {
	return os.WriteFile(s.hmrGatePath(lwDir), []byte(strconv.FormatInt(expiryUnixMs, 10)+"\n"), 0o644)
}

// ReadHMRGate reads the gate expiry (unix-ms); ok is false when no gate is set.
func (s *Store) ReadHMRGate(lwDir string) (int64, bool) {
	b, err := os.ReadFile(s.hmrGatePath(lwDir))
	if err != nil {
		return 0, false
	}
	n, err := strconv.ParseInt(strings.TrimSpace(string(b)), 10, 64)
	if err != nil {
		return 0, false
	}
	return n, true
}

// ClearHMRGate removes the marker so HMR resumes immediately.
func (s *Store) ClearHMRGate(lwDir string) { _ = os.Remove(s.hmrGatePath(lwDir)) }

// SaveDaemon / Daemon / ClearDaemon manage the singleton daemon record.
func (s *Store) SaveDaemon(info app.DaemonInfo) error {
	if err := os.MkdirAll(s.home, 0o755); err != nil {
		return err
	}
	b, _ := json.MarshalIndent(info, "", "  ")
	return os.WriteFile(s.daemonPath(), append(b, '\n'), 0o644)
}

func (s *Store) Daemon() (app.DaemonInfo, bool) {
	var d app.DaemonInfo
	b, err := os.ReadFile(s.daemonPath())
	if err != nil {
		return d, false
	}
	if json.Unmarshal(b, &d) != nil {
		return d, false
	}
	return d, true
}

func (s *Store) ClearDaemon() { _ = os.Remove(s.daemonPath()) }
