// Package fileregistry implements app.Store on the filesystem: the cross-worktree
// registry + daemon record under the thuishaven home dir, plus the two
// worktree-local files (the slug cache, the sticky selection and the HMR gate).
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
//
// A `"workers"` key written before the worker became its own application is
// simply not decoded any more, which is the point of dropping the field rather
// than keeping it: every one of those files says `"workers": false`, and a
// field would read that as "run no background processing at all".
type selectionFields struct {
	Gateway *bool `json:"gateway"`
	NLP     *bool `json:"nlp"`
	Langy   *bool `json:"langy"`
	IDP     *bool `json:"idp"`
	// The two developer tools, both off by default and both stated here the
	// same way as the rest, so a file written before they existed keeps
	// leaving them off rather than reading as a deliberate choice.
	DesignSystem *bool `json:"design-system"`
	MailRoom     *bool `json:"mail-room"`
	// LegacyDesignSystem / LegacyMailRoom decode the pre-rename keys
	// (`"storybook"` / `"mail"`) a worktree's .haven.json may still carry.
	// applyTo prefers the new key when both are present; WriteSelection never
	// writes these, so the next `haven up` in that worktree migrates the file
	// to the new spelling instead of silently dropping the lane it had turned
	// on.
	LegacyDesignSystem *bool `json:"storybook,omitempty"`
	LegacyMailRoom     *bool `json:"mail,omitempty"`
}

// applyTo overlays the services this file actually states onto sel.
func (f selectionFields) applyTo(sel *domain.Selection) {
	for _, field := range []struct{ stated, legacy, target *bool }{
		{f.Gateway, nil, &sel.Gateway},
		{f.NLP, nil, &sel.NLP},
		{f.Langy, nil, &sel.Langy},
		{f.IDP, nil, &sel.IDP},
		{f.DesignSystem, f.LegacyDesignSystem, &sel.DesignSystem},
		{f.MailRoom, f.LegacyMailRoom, &sel.MailRoom},
	} {
		switch {
		case field.stated != nil:
			*field.target = *field.stated
		case field.legacy != nil:
			*field.target = *field.legacy
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
		Gateway:      &sel.Gateway,
		NLP:          &sel.NLP,
		Langy:        &sel.Langy,
		IDP:          &sel.IDP,
		DesignSystem: &sel.DesignSystem,
		MailRoom:     &sel.MailRoom,
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

// prereqSkipsPath is the machine-wide record of which prerequisites `haven
// install` was told never to ask about again. It lives beside the registry
// rather than in a worktree: what is installed on the machine is the same
// answer from every checkout, and so is the developer's decision about it.
func (s *Store) prereqSkipsPath() string { return filepath.Join(s.home, "install-skips.json") }

// prereqSkipsFile is the on-disk shape: what `haven install` was told about
// this machine. A list for the skips rather than a map, so the file reads as
// the sentence it is ("never ask me about these") and a hand edit is obvious.
type prereqSkipsFile struct {
	Skipped []string `json:"skipped"`
	// ContainerPosture is colima, docker or none — the one answer every
	// container-shaped decision downstream is derived from. Empty means the
	// developer has never chosen, which is what makes haven look instead.
	ContainerPosture string `json:"containerPosture,omitempty"`
}

// readPrereqFile loads the whole record. Absent, unreadable or corrupt all
// read as empty: a preference nobody has expressed yet is not a failure, and
// a truncated file must not be able to block the install command entirely.
func (s *Store) readPrereqFile() prereqSkipsFile {
	var f prereqSkipsFile
	b, err := os.ReadFile(s.prereqSkipsPath())
	if err != nil {
		return prereqSkipsFile{}
	}
	if json.Unmarshal(b, &f) != nil {
		return prereqSkipsFile{}
	}
	return f
}

// writePrereqFile replaces the record, sorted so it does not churn between
// runs that record the same thing in a different order.
func (s *Store) writePrereqFile(f prereqSkipsFile) error {
	if err := os.MkdirAll(s.home, 0o755); err != nil {
		return err
	}
	if f.Skipped == nil {
		f.Skipped = []string{}
	}
	sort.Strings(f.Skipped)
	b, err := json.MarshalIndent(f, "", "  ")
	if err != nil {
		return err
	}
	return writeFileAtomic(s.prereqSkipsPath(), append(b, '\n'), 0o644)
}

// ReadContainerPosture is the machine's stated container posture, "" when
// never chosen.
func (s *Store) ReadContainerPosture() string { return s.readPrereqFile().ContainerPosture }

// WriteContainerPosture records it, leaving the skips in the same file alone.
func (s *Store) WriteContainerPosture(posture string) error {
	f := s.readPrereqFile()
	f.ContainerPosture = posture
	return s.writePrereqFile(f)
}

// ReadPrereqSkips loads the never-ask-again set.
func (s *Store) ReadPrereqSkips() map[string]bool {
	skips := map[string]bool{}
	for _, key := range s.readPrereqFile().Skipped {
		skips[key] = true
	}
	return skips
}

// WritePrereqSkips replaces the set, leaving the posture in the same file
// alone.
func (s *Store) WritePrereqSkips(skips map[string]bool) error {
	f := s.readPrereqFile()
	f.Skipped = []string{}
	for key, on := range skips {
		if on {
			f.Skipped = append(f.Skipped, key)
		}
	}
	return s.writePrereqFile(f)
}

// hmrGatePath is the marker the Vite HMR-gate plugin reads. The plugin resolves
// it against its own working directory, which is the Vite lane's — apps/ui —
// so the marker is written there, not at the workspace root.
func (s *Store) hmrGatePath(uiDir string) string {
	return filepath.Join(uiDir, ".haven-hmr-gate")
}

// WriteHMRGate writes the gate expiry (unix-ms) so Vite defers HMR until then.
func (s *Store) WriteHMRGate(uiDir string, expiryUnixMs int64) error {
	return os.WriteFile(s.hmrGatePath(uiDir), []byte(strconv.FormatInt(expiryUnixMs, 10)+"\n"), 0o644)
}

// ReadHMRGate reads the gate expiry (unix-ms); ok is false when no gate is set.
func (s *Store) ReadHMRGate(uiDir string) (int64, bool) {
	b, err := os.ReadFile(s.hmrGatePath(uiDir))
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
func (s *Store) ClearHMRGate(uiDir string) { _ = os.Remove(s.hmrGatePath(uiDir)) }

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

// heavyRunClaim is one heavy-run marker's payload - enough to say what it is
// and how long it has been running.
type heavyRunClaim struct {
	Command string    `json:"command"`
	At      time.Time `json:"at"`
}

// readHeavyRunClaim reads and parses one marker. ok is false when the file
// cannot be read or parsed - the caller decides what that means for liveness.
func readHeavyRunClaim(path string) (heavyRunClaim, bool) {
	b, err := os.ReadFile(path) // #nosec G304 -- path is built from haven's own home dir
	if err != nil {
		return heavyRunClaim{}, false
	}
	var rec heavyRunClaim
	if json.Unmarshal(b, &rec) != nil || rec.At.IsZero() {
		return heavyRunClaim{}, false
	}
	return rec, true
}

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
	rec, ok := readHeavyRunClaim(path)
	if !ok {
		return false
	}
	age := time.Since(rec.At)
	return age < 0 || age > HeavyRunClaimTTL
}

// HeavyRunSnapshots lists the heavy runs currently holding a slot, across
// every worktree and terminal, with what a wait estimate needs: which command
// and when it started. Same liveness and expiry rule as HeavyRuns; a marker
// this cannot parse still counts there but is skipped here, since there is
// nothing to report about it.
func (s *Store) HeavyRunSnapshots() []app.HeavyRunSnapshot {
	entries, err := os.ReadDir(s.heavyRunsDir())
	if err != nil {
		return nil
	}
	var out []app.HeavyRunSnapshot
	for _, e := range entries {
		pid, err := strconv.Atoi(strings.TrimSuffix(e.Name(), ".json"))
		if err != nil {
			continue
		}
		path := filepath.Join(s.heavyRunsDir(), e.Name())
		if !processAlive(pid) || s.heavyRunExpired(path) {
			continue
		}
		if rec, ok := readHeavyRunClaim(path); ok {
			out = append(out, app.HeavyRunSnapshot{Command: rec.Command, StartedAt: rec.At})
		}
	}
	return out
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

func (s *Store) waitersDir(name string) string { return filepath.Join(s.home, "waiters", name) }

// WaiterClaimTTL is how long a queued-run marker is believed. Comfortably
// above domain.LongFailsafe (the longest anything waits before running
// anyway), so a live, still-waiting run is never mistaken for a stale one.
const WaiterClaimTTL = 2 * time.Hour

// WaiterClaim is one queued run's registration - what the priority scheduler
// (specs/setup/check-slots.feature, "Priority with aging") needs to compare
// it against every other current waiter.
type WaiterClaim struct {
	Command         string            `json:"command"`
	Caller          domain.CallerKind `json:"caller"`
	AgentID         string            `json:"agentId,omitempty"`
	QueuedAt        time.Time         `json:"queuedAt"`
	OverrideHonored bool              `json:"overrideHonored,omitempty"`
}

// WaiterSnapshot is one currently-queued run, as WaiterClaim plus the pid it
// was registered under - what lets a caller exclude its own registration
// when it compares itself against everyone else waiting.
type WaiterSnapshot struct {
	PID int
	WaiterClaim
}

// ClaimWaiter registers this process as queued for name's slot. The release
// removes the marker; unlike a heavy-run claim there is nothing here to
// resume from a crash - a queued run that dies simply stops competing, which
// a dropped pid file already expresses with no further bookkeeping.
func (s *Store) ClaimWaiter(pid int, name string, claim WaiterClaim) (func(), error) {
	dir := s.waitersDir(name)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return func() {}, err
	}
	path := filepath.Join(dir, strconv.Itoa(pid)+".json")
	b, err := json.Marshal(claim)
	if err != nil {
		return func() {}, err
	}
	if err := writeFileAtomic(path, b, 0o644); err != nil {
		return func() {}, err
	}
	return func() { _ = os.Remove(path) }, nil
}

// WaiterSnapshots lists every run currently queued for name's slot, across
// every worktree and terminal. Same liveness rule as HeavyRunSnapshots: a
// dead pid or an expired marker is swept as it is found rather than reported,
// and a marker this cannot parse is dropped rather than reaching code that
// assumes its fields.
func (s *Store) WaiterSnapshots(name string) []WaiterSnapshot {
	dir := s.waitersDir(name)
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil
	}
	var out []WaiterSnapshot
	for _, e := range entries {
		if snap, ok := waiterFromEntry(dir, e.Name()); ok {
			out = append(out, snap)
		}
	}
	return out
}

// waiterFromEntry reads one waiter marker file, sweeping it away and
// reporting ok=false whenever it is not a live, current waiter: not a pid at
// all, a dead process, unparseable, or a marker past WaiterClaimTTL.
func waiterFromEntry(dir, name string) (WaiterSnapshot, bool) {
	pid, err := strconv.Atoi(strings.TrimSuffix(name, ".json"))
	if err != nil {
		return WaiterSnapshot{}, false
	}
	path := filepath.Join(dir, name)
	if !processAlive(pid) {
		_ = os.Remove(path)
		return WaiterSnapshot{}, false
	}
	claim, ok := readWaiterClaim(path)
	if !ok {
		return WaiterSnapshot{}, false
	}
	if age := time.Since(claim.QueuedAt); age < 0 || age > WaiterClaimTTL {
		_ = os.Remove(path)
		return WaiterSnapshot{}, false
	}
	return WaiterSnapshot{PID: pid, WaiterClaim: claim}, true
}

// readWaiterClaim reads and parses one waiter marker. ok is false when the
// file cannot be read or parsed at all - the caller drops it rather than
// reaching code that assumes its fields.
func readWaiterClaim(path string) (WaiterClaim, bool) {
	b, err := os.ReadFile(path) // #nosec G304 -- path is built from haven's own home dir
	if err != nil {
		return WaiterClaim{}, false
	}
	var claim WaiterClaim
	if json.Unmarshal(b, &claim) != nil || claim.QueuedAt.IsZero() {
		return WaiterClaim{}, false
	}
	return claim, true
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

// runHistoryPath is beside the semaphore's home, one JSON object per line so
// a crash mid-append leaves only the last line to lose rather than the file.
func (s *Store) runHistoryPath() string { return filepath.Join(s.home, "run-history.jsonl") }

// AppendRunHistory records one completed heavy run, capped at
// domain.RunHistoryCap (oldest dropped). Best-effort: the caller must not
// fail a real run over a history write, so every error here is returned for
// the caller to log rather than to act on.
func (s *Store) AppendRunHistory(rec domain.RunRecord) error {
	if err := os.MkdirAll(s.home, 0o750); err != nil {
		return err
	}
	release, err := s.lockRunHistory()
	if err != nil {
		return err
	}
	defer release()

	all := append(s.readRunHistory(), rec)
	if len(all) > domain.RunHistoryCap {
		all = all[len(all)-domain.RunHistoryCap:]
	}
	return s.writeRunHistory(all)
}

// RunHistory reads the recent history newest-last. Absent or unreadable is an
// empty history - every caller already treats that as "cannot estimate"
// rather than an error.
func (s *Store) RunHistory() []domain.RunRecord { return s.readRunHistory() }

func (s *Store) readRunHistory() []domain.RunRecord {
	b, err := os.ReadFile(s.runHistoryPath())
	if err != nil {
		return nil
	}
	var out []domain.RunRecord
	for _, line := range strings.Split(strings.TrimSpace(string(b)), "\n") {
		if line == "" {
			continue
		}
		var rec domain.RunRecord
		if json.Unmarshal([]byte(line), &rec) == nil {
			out = append(out, rec)
		}
	}
	return out
}

func (s *Store) writeRunHistory(records []domain.RunRecord) error {
	var b strings.Builder
	for _, rec := range records {
		line, err := json.Marshal(rec)
		if err != nil {
			continue
		}
		b.Write(line)
		b.WriteByte('\n')
	}
	return writeFileAtomic(s.runHistoryPath(), []byte(b.String()), 0o644)
}

// lockRunHistory takes the exclusive lock guarding the history file, the same
// pattern as lockDurations and for the same reason: the writer renames a
// fresh file over the path, so the lock has to be its own file rather than
// one on an inode a concurrent writer is about to replace.
func (s *Store) lockRunHistory() (func(), error) {
	f, err := os.OpenFile(s.runHistoryPath()+".lock", os.O_CREATE|os.O_RDWR, 0o600)
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
