// Package fileregistry implements app.Store on the filesystem: the cross-worktree
// registry + daemon record under the thuishaven home dir, plus the two
// worktree-local files (the slug cache and the .env.portless overlay).
package fileregistry

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/adapters/atomicfile"
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

// selectionFile is the on-disk shape of the worktree-local sticky service
// selection (ADR-064) — .haven.json next to .langwatch-slug.
type selectionFile struct {
	Services *selectionFields `json:"services"`
}

// selectionFields is domain.Selection with every service optional. The pointers
// are the whole point: decoding straight into a Selection makes an absent key
// indistinguishable from a false one, so a file naming only what the developer
// turned ON — the natural thing to hand-write, and what a truncated or
// hand-merged file looks like — would silently strip gateway and nlp off the
// stack. Absent means "not stated", and what is not stated keeps its default.
type selectionFields struct {
	Workers *bool `json:"workers"`
	Gateway *bool `json:"gateway"`
	NLP     *bool `json:"nlp"`
	Langy   *bool `json:"langy"`
	IDP     *bool `json:"idp"`
}

// applyTo overlays the services this file actually states onto sel.
func (f selectionFields) applyTo(sel *domain.Selection) {
	for _, field := range []struct{ stated, target *bool }{
		{f.Workers, &sel.Workers},
		{f.Gateway, &sel.Gateway},
		{f.NLP, &sel.NLP},
		{f.Langy, &sel.Langy},
		{f.IDP, &sel.IDP},
	} {
		if field.stated != nil {
			*field.target = *field.stated
		}
	}
}

func selectionPath(worktreeDir string) string {
	return filepath.Join(worktreeDir, ".haven.json")
}

// ReadSelection reads the worktree's sticky service selection; ok is false when
// none has been written yet, or the file states no services at all (callers
// fall back to the lean default). A file that states some services and not
// others is honoured for the ones it states — the rest keep their default
// rather than decoding to off.
func (s *Store) ReadSelection(worktreeDir string) (domain.Selection, bool) {
	b, err := os.ReadFile(selectionPath(worktreeDir))
	if err != nil {
		return domain.Selection{}, false
	}
	var f selectionFile
	if json.Unmarshal(b, &f) != nil || f.Services == nil {
		return domain.Selection{}, false
	}
	sel := domain.DefaultSelection()
	f.Services.applyTo(&sel)
	return sel, true
}

// WriteSelection persists the worktree's sticky service selection. The write is
// atomic (temp file + rename): a crash mid-write must never leave a half-written
// .haven.json, which ReadSelection can't tell from "never written" and would
// silently reset the sticky selection to the lean default.
// A written file always states every service, so haven's own writes never rely
// on the default-keeping behaviour above — that is there for files it did not
// write.
func (s *Store) WriteSelection(worktreeDir string, sel domain.Selection) error {
	b, err := json.MarshalIndent(selectionFile{Services: &selectionFields{
		Workers: &sel.Workers,
		Gateway: &sel.Gateway,
		NLP:     &sel.NLP,
		Langy:   &sel.Langy,
		IDP:     &sel.IDP,
	}}, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(selectionPath(worktreeDir), append(b, '\n'), 0o644)
}

// writeFileAtomic writes data to a temp file in the destination directory and
// renames it into place, so a reader never observes a partial file.
func writeFileAtomic(path string, data []byte, perm os.FileMode) error {
	return atomicfile.Write(path, data, perm)
}

// WriteOverlay writes .env.portless. Mode 0o600: it carries
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

// dbActivityPath is the machine-wide last-seen clock for per-slug databases.
func (s *Store) dbActivityPath() string { return filepath.Join(s.home, "db-activity.json") }

func (s *Store) TouchDBActivity(slug string) error {
	if slug == "" {
		return nil
	}
	if err := os.MkdirAll(s.home, 0o755); err != nil {
		return err
	}
	m := s.DBActivity()
	m[slug] = time.Now()
	return s.writeDBActivity(m)
}

func (s *Store) DBActivity() map[string]time.Time {
	m := map[string]time.Time{}
	b, err := os.ReadFile(s.dbActivityPath())
	if err != nil {
		return m
	}
	_ = json.Unmarshal(b, &m)
	return m
}

func (s *Store) RemoveDBActivity(slug string) {
	m := s.DBActivity()
	if _, ok := m[slug]; !ok {
		return
	}
	delete(m, slug)
	_ = s.writeDBActivity(m)
}

func (s *Store) writeDBActivity(m map[string]time.Time) error {
	b, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(s.dbActivityPath(), append(b, '\n'), 0o644)
}

// ClaimDaemon / Daemon / ClearDaemon manage the singleton daemon record.

// ClaimDaemon writes the daemon record only if none exists yet. The O_EXCL
// create is atomic across processes, so of two daemons racing to start exactly
// one claims the slot; the loser gets (false, nil) and an untouched record. A
// stale record left by a crashed daemon must be cleared (ClearDaemon) before the
// claim can succeed — ClaimDaemon itself never overwrites.
func (s *Store) ClaimDaemon(info app.DaemonInfo) (bool, error) {
	if err := os.MkdirAll(s.home, 0o755); err != nil {
		return false, err
	}
	f, err := os.OpenFile(s.daemonPath(), os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
	if err != nil {
		if os.IsExist(err) {
			return false, nil
		}
		return false, err
	}
	defer func() { _ = f.Close() }()
	b, _ := json.MarshalIndent(info, "", "  ")
	if _, err := f.Write(append(b, '\n')); err != nil {
		return false, err
	}
	return true, nil
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

func (s *Store) heavyRunsDir() string  { return filepath.Join(s.home, "heavy-runs") }
func (s *Store) durationsPath() string { return filepath.Join(s.home, "run-durations.json") }

// HeavyRuns counts the heavy runs live on this machine, across every worktree
// and terminal.
//
// Occupancy is derived from whether each recorded pid is still alive rather
// than from a counter anyone has to decrement, so a killed run frees its place
// with no bookkeeping — the same property the shared check queue relies on. A
// dead entry is swept as it is found.
//
// Liveness alone is not enough, which is why the timestamp is read as well. Pids
// are recycled, and an orphaned marker whose number has been handed to some
// long-lived process reads as live forever — the pool then counts a run that
// ended days ago and caps every real one behind it.
func (s *Store) HeavyRuns() int {
	entries, err := os.ReadDir(s.heavyRunsDir())
	if err != nil {
		return 0
	}
	live := 0
	for _, e := range entries {
		pid, err := strconv.Atoi(strings.TrimSuffix(e.Name(), ".json"))
		path := filepath.Join(s.heavyRunsDir(), e.Name())
		if err != nil {
			continue
		}
		if processAlive(pid) && !s.heavyRunExpired(path) {
			live++
			continue
		}
		_ = os.Remove(path)
	}
	return live
}

// HeavyRunClaimTTL is how long a claim is believed. Far longer than any real
// heavy run — the longest thing on the list is a docker build — so it never
// expires a run out from under itself, and short enough that a recycled pid
// cannot hold a slot for a working day.
const HeavyRunClaimTTL = 6 * time.Hour

// heavyRunExpired reads the claim's own timestamp. A marker that cannot be read
// or parsed has not expired: the pid check already said something is alive
// there, and inventing an expiry from an unreadable file would free a slot that
// is genuinely in use.
//
// A timestamp in the FUTURE is expired, not fresh. Its age is negative, so it
// would otherwise sit under the TTL until that date arrived — a clock rollback
// or one corrupt record holding machine-wide capacity for as long as it likes.
// The same rule as domain.LiveSpawns, for the same reason.
func (s *Store) heavyRunExpired(path string) bool {
	b, err := os.ReadFile(path) // #nosec G304 -- path is built from haven's own home dir
	if err != nil {
		return false
	}
	var rec struct {
		At time.Time `json:"at"`
	}
	if json.Unmarshal(b, &rec) != nil || rec.At.IsZero() {
		return false
	}
	age := time.Since(rec.At)
	return age < 0 || age > HeavyRunClaimTTL
}

// ClaimHeavyRun records this process as holding a heavy slot.
func (s *Store) ClaimHeavyRun(pid int, command string) (func(), error) {
	if err := os.MkdirAll(s.heavyRunsDir(), 0o750); err != nil {
		return func() {}, err
	}
	path := filepath.Join(s.heavyRunsDir(), strconv.Itoa(pid)+".json")
	b, err := json.Marshal(map[string]any{"pid": pid, "command": command, "at": time.Now()})
	if err != nil {
		return func() {}, err
	}
	if err := writeFileAtomic(path, b, 0o644); err != nil {
		return func() {}, err
	}
	return func() { _ = os.Remove(path) }, nil
}

// processAlive reports whether a pid is a live process. Signal 0 tests for
// existence without delivering anything; EPERM means it exists but belongs to
// someone else, which still counts as occupied — a heavy run started under
// another uid on a shared machine holds its slot exactly like any other, and
// reading its refusal as "gone" would free the slot while the run continues.
func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	p, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	err = p.Signal(syscall.Signal(0))
	return err == nil || errors.Is(err, syscall.EPERM)
}

// ObservedDuration is how long this kind of command has taken before, or zero
// when it has never been timed. Zero is load-bearing: callers treat an
// unobserved command as long, so it queues rather than being narrowed on a
// guess.
func (s *Store) ObservedDuration(key string) time.Duration {
	if key == "" {
		return 0
	}
	return s.readDurations()[key]
}

// ObserveDuration folds a completed run into the running estimate.
//
// An exponential moving average rather than a stored history: one file, no
// growth, and a machine that gets slower (or a suite that gets bigger) is
// tracked within a few runs instead of being anchored to whatever the first
// one happened to cost.
//
// Held under a lock for the whole read-modify-write. The file holds every
// command's estimate in one map and the write publishes all of it, so two runs
// finishing together would each write a map built before the other's update and
// the later writer would drop the earlier one's key. A dropped key reads back
// as never-observed, and the run that follows queues at full width instead of
// narrowing — the safe direction, but not a free one, and this is the case
// haven is built for: several agents finishing at once.
func (s *Store) ObserveDuration(key string, took time.Duration) {
	if key == "" || took <= 0 {
		return
	}
	_ = os.MkdirAll(s.home, 0o750)
	release, err := s.lockDurations()
	if err != nil {
		// Rather than skip the observation: an interleaved write costs one
		// estimate, and never writing costs every estimate on this machine.
		release = func() {}
	}
	defer release()

	all := s.readDurations()
	if prev, ok := all[key]; ok {
		took = (prev*3 + took) / 4
	}
	all[key] = took
	if b, err := json.Marshal(all); err == nil {
		_ = writeFileAtomic(s.durationsPath(), b, 0o644)
	}
}

// lockDurations takes the exclusive lock guarding the durations file.
//
// The lock is its own file rather than the durations file itself, because the
// writer renames a fresh file over that path: a lock held on the old inode
// would guard a file no longer at the name, which is no lock at all.
func (s *Store) lockDurations() (func(), error) {
	f, err := os.OpenFile(s.durationsPath()+".lock", os.O_CREATE|os.O_RDWR, 0o600)
	if err != nil {
		return nil, err
	}
	if err := syscall.Flock(int(f.Fd()), syscall.LOCK_EX); err != nil {
		_ = f.Close()
		return nil, err
	}
	return func() {
		_ = syscall.Flock(int(f.Fd()), syscall.LOCK_UN)
		_ = f.Close()
	}, nil
}

func (s *Store) readDurations() map[string]time.Duration {
	out := map[string]time.Duration{}
	b, err := os.ReadFile(s.durationsPath())
	if err != nil {
		return out
	}
	_ = json.Unmarshal(b, &out)
	return out
}

func (s *Store) pressurePath() string { return filepath.Join(s.home, "pressure.json") }

// WritePressure publishes the daemon's current reading of the machine.
//
// Written atomically because every other process on the box reads it while the
// daemon is rewriting it, and a half-written record must never be observed —
// though a reader that did see one treats it as absent, so the worst case is a
// tick of green rather than a crash.
func (s *Store) WritePressure(rec domain.PressureRecord) error {
	b, err := json.Marshal(rec)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return err
	}
	return writeFileAtomic(s.pressurePath(), b, 0o644)
}

// ReadPressure returns the published record, or ok=false when there is nothing
// trustworthy to read. Callers pass the result to domain.ReadPressure, which
// resolves absent, stale and unknown-version alike to green.
func (s *Store) ReadPressure() (domain.PressureRecord, bool) {
	var rec domain.PressureRecord
	b, err := os.ReadFile(s.pressurePath())
	if err != nil {
		return rec, false
	}
	if json.Unmarshal(b, &rec) != nil {
		return rec, false
	}
	return rec, true
}

func (s *Store) reapEventsPath() string { return filepath.Join(s.home, "reap-events.json") }

// AppendReapEvent appends one daemon reclamation to the bounded record. The
// daemon is the only writer (its monitor goroutine), so read-modify-write with
// an atomic replace is race-free in practice; the hub only ever reads.
func (s *Store) AppendReapEvent(ev domain.ReapEvent) error {
	events := domain.AppendReapEvent(s.ReapEvents(), ev)
	b, err := json.Marshal(events)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return err
	}
	return writeFileAtomic(s.reapEventsPath(), b, 0o644)
}

// ReapEvents reads the record newest-last. Absent or unreadable is an empty
// record — the hub shows "nothing reaped", never an error.
func (s *Store) ReapEvents() []domain.ReapEvent {
	b, err := os.ReadFile(s.reapEventsPath())
	if err != nil {
		return nil
	}
	var events []domain.ReapEvent
	if json.Unmarshal(b, &events) != nil {
		return nil
	}
	return events
}
