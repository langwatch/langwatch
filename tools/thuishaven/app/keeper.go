package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// keeperHandover bounds how long an up waits for its keeper to take the record
// (race 1 in section 11.2 of dev/docs/plans/haven-one-go-process-2026-10-09.md).
const keeperHandover = 10 * time.Second

// KeeperPlan is what `haven keep` runs. Env is the up's base environment,
// secrets included: the file is 0600, removed on down and never logged.
type KeeperPlan struct {
	Children   []Child   `json:"children"`
	Env        []string  `json:"env"`
	StartedAt  time.Time `json:"startedAt"`
	OwnerPID   int       `json:"ownerPid,omitempty"`
	OwnerStart string    `json:"ownerStart,omitempty"`
}

func keeperPlanPath(worktreeDir, slug string) string {
	dir, _ := domain.StackLogPaths(worktreeDir, slug)
	return filepath.Join(dir, "plan.json")
}

// writeKeeperPlan creates the file afresh with O_EXCL, so the environment is
// never written into an older, wider file or through a planted symlink.
func writeKeeperPlan(path string, plan KeeperPlan) error {
	data, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
		return err
	}
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

// ignoreHavenState drops a `*` .gitignore into the worktree's .haven, so a
// checkout whose own .gitignore predates `.haven/` (origin/main today) never
// stages the plan or the logs. An existing file is left as it is.
func ignoreHavenState(worktreeDir string) error {
	root := filepath.Dir(domain.HavenLogsRoot(worktreeDir))
	if err := os.MkdirAll(root, 0o700); err != nil {
		return err
	}
	f, err := os.OpenFile(filepath.Join(root, ".gitignore"), os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0o600)
	if errors.Is(err, os.ErrExist) {
		return nil
	}
	if err != nil {
		return err
	}
	if _, err := f.WriteString("*\n"); err != nil {
		_ = f.Close()
		return err
	}
	return f.Close()
}

func removeKeeperPlan(worktreeDir, slug string) {
	_ = os.Remove(keeperPlanPath(worktreeDir, slug))
}

// ReadKeeperPlan loads the plan of a registered stack. The keeper replays its
// environment, so only this user's private regular file is read, never through
// a symlink. An error names no content, because the content is the environment.
func (o *Orchestrator) ReadKeeperPlan(slug string) (KeeperPlan, error) {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return KeeperPlan{}, fmt.Errorf("no stack %q to keep", slug)
	}
	f, err := os.OpenFile(keeperPlanPath(st.WorktreeDir, slug), os.O_RDONLY|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return KeeperPlan{}, err
	}
	defer func() { _ = f.Close() }()
	if !isPrivateFile(f) {
		return KeeperPlan{}, fmt.Errorf("the keeper plan for %q is not this user's owner-only file", slug)
	}
	var plan KeeperPlan
	if json.NewDecoder(f).Decode(&plan) != nil {
		return KeeperPlan{}, fmt.Errorf("the keeper plan for %q is unreadable", slug)
	}
	return plan, nil
}

// isPrivateFile is whether f is a regular file this user owns with no group or
// other permission bits.
func isPrivateFile(f *os.File) bool {
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Mode().Perm()&0o077 != 0 {
		return false
	}
	st, ok := info.Sys().(*syscall.Stat_t)
	return ok && int64(st.Uid) == int64(os.Getuid())
}

// Keep is `haven keep <slug>`: it takes the record, runs the plan's lanes until
// signaled, then tears the stack down as the launcher did. The caller has
// already applied plan.Env.
func (o *Orchestrator) Keep(ctx context.Context, slug string, plan KeeperPlan) error {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no stack %q to keep", slug)
	}
	pid := o.sys.Getpid()
	st.LauncherPID, st.LauncherStart = pid, o.sys.ProcessStart(pid)
	st.OwnerPID, st.OwnerStart = plan.OwnerPID, plan.OwnerStart
	st.UpdatedAt = o.sys.Now()
	if err := o.store.SaveStack(st); err != nil {
		return err
	}
	stopBeat := o.startHeartbeat(ctx, st)
	o.sup.Supervise(ctx, plan.Children)
	stopBeat()
	o.dropKeptStack(st)
	return nil
}

// dropKeptStack is the keeper's teardown. A record that names another launcher
// (an `up --force` replaced this one) is left to its new keeper. A record
// already gone (DownStack removes it) still takes this keeper's plan with it.
func (o *Orchestrator) dropKeptStack(st domain.Stack) {
	cur, ok := o.stackBySlug(st.Slug)
	if !ok {
		removeKeeperPlan(st.WorktreeDir, st.Slug)
		return
	}
	if cur.LauncherPID != st.LauncherPID {
		return
	}
	if !cur.PortlessDisabled {
		o.removeStackRoutes(cur.Slug, cur.Services)
	}
	o.store.RemoveStack(cur.Slug)
	removeKeeperPlan(cur.WorktreeDir, cur.Slug)
}

// startHeartbeat runs heartbeat until the returned stop, which waits for it to
// end, so no beat lands after a hand-over or a teardown.
func (o *Orchestrator) startHeartbeat(ctx context.Context, st domain.Stack) func() {
	ctx, cancel := context.WithCancel(ctx)
	done := make(chan struct{})
	go func() {
		defer close(done)
		o.heartbeat(ctx, st)
	}()
	return func() {
		cancel()
		<-done
	}
}

// handOver gives a provisioned stack to its keeper: write the plan, start
// `haven keep` in its own session and wait for the keeper's pid in the record.
// The caller has stopped its heartbeat, so no beat overwrites the keeper's.
// Until S4c the up starts the keeper itself.
func (o *Orchestrator) handOver(st domain.Stack, children []Child, isOwner bool) error {
	if len(o.cfg.KeepArgv) == 0 {
		return errors.New("no keeper command configured")
	}
	self := o.sys.Getpid()
	plan := KeeperPlan{Children: children, Env: os.Environ(), StartedAt: o.sys.Now()}
	if isOwner {
		plan.OwnerPID, plan.OwnerStart = self, o.sys.ProcessStart(self)
	}
	if err := ignoreHavenState(st.WorktreeDir); err != nil {
		return fmt.Errorf("keeping .haven out of git: %w", err)
	}
	if err := writeKeeperPlan(keeperPlanPath(st.WorktreeDir, st.Slug), plan); err != nil {
		return fmt.Errorf("writing the keeper plan: %w", err)
	}
	argv := append(append([]string{}, o.cfg.KeepArgv...), st.Slug, "--agent")
	_, combined := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	if err := o.sys.SpawnDetached(argv, st.WorktreeDir, combined); err != nil {
		return fmt.Errorf("starting the keeper: %w", err)
	}
	return o.awaitKeeper(st.Slug, self, keeperHandover)
}

// awaitKeeper waits until the record names a launcher that is ours and is not
// this process.
func (o *Orchestrator) awaitKeeper(slug string, self int, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	for {
		st, ok := o.stackBySlug(slug)
		if !ok {
			return fmt.Errorf("stack %q was torn down during the hand-over", slug)
		}
		if st.LauncherPID != self && st.LauncherPID != 0 && o.launcherIsOurs(st) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the keeper for %q did not take the stack within %s", slug, timeout)
		}
		time.Sleep(50 * time.Millisecond)
	}
}

// IsStackOwner is whether pid is the foreground up that owns slug's running
// stack (D7). Liveness only, no ps: the owner asks it on every follow tick.
func (o *Orchestrator) IsStackOwner(slug string, pid int) bool {
	st, ok := o.stackBySlug(slug)
	return ok && st.OwnerPID == pid && o.sys.ProcessAlive(st.LauncherPID)
}
