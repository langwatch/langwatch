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

// keeperHandover bounds how long the daemon waits for a keeper to take the record
// (race 1 in section 11.2 of dev/docs/plans/haven-one-go-process-2026-10-09.md).
const keeperHandover = 10 * time.Second

// KeeperPlan is what `haven keep` runs. Env is the up's base environment,
// secrets included: the file is 0600, removed on down and never logged. The
// provisioner is the up that wrote it, the one launcher a keeper may replace.
type KeeperPlan struct {
	Children         []Child   `json:"children"`
	Env              []string  `json:"env"`
	StartedAt        time.Time `json:"startedAt"`
	ProvisionerPID   int       `json:"provisionerPid"`
	ProvisionerStart string    `json:"provisionerStart,omitempty"`
	OwnerPID         int       `json:"ownerPid,omitempty"`
	OwnerStart       string    `json:"ownerStart,omitempty"`
}

// keeperPlanPath sits in an owner-only run dir beside the logs, never in the
// log dir people browse (ruling R1, 2026-10-09).
func keeperPlanPath(worktreeDir, slug string) string {
	return filepath.Join(filepath.Dir(domain.HavenLogsRoot(worktreeDir)), "run", slug, "plan.json")
}

// writeKeeperPlan creates the file afresh with O_EXCL, so the environment is
// never written into an older, wider file or through a planted symlink.
func writeKeeperPlan(path string, plan KeeperPlan) error {
	data, err := json.Marshal(plan)
	if err != nil {
		return err
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(filepath.Dir(dir), 0o700); err != nil {
		return err
	}
	// The run dir holds only this file: recreated, it is owner-only whatever was there.
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	if err := os.Mkdir(dir, 0o700); err != nil {
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
	_ = os.RemoveAll(filepath.Dir(keeperPlanPath(worktreeDir, slug)))
	// shortcut: S4b wrote the plan into the log dir; drop this once no S4b stack can be left.
	logDir, _ := domain.StackLogPaths(worktreeDir, slug)
	_ = os.Remove(filepath.Join(logDir, "plan.json"))
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
// signaled or until the record is no longer its own, then tears the stack down
// as the launcher did. It never takes over a live keeper (ruling R3); the
// caller has already applied plan.Env.
func (o *Orchestrator) Keep(ctx context.Context, slug string, plan KeeperPlan) error {
	st, ok := o.stackBySlug(slug)
	if !ok {
		return fmt.Errorf("no stack %q to keep", slug)
	}
	if st.LauncherPID != plan.ProvisionerPID && o.launcherIsOurs(st) {
		return fmt.Errorf("stack %q already has a live keeper (pid %d)", slug, st.LauncherPID)
	}
	pid := o.sys.Getpid()
	st.LauncherPID, st.LauncherStart = pid, o.sys.ProcessStart(pid)
	st.OwnerPID, st.OwnerStart = plan.OwnerPID, plan.OwnerStart
	st.UpdatedAt = o.sys.Now()
	if err := o.store.SaveStack(st); err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	beat := make(chan struct{})
	go func() {
		defer close(beat)
		o.heartbeat(ctx, st)
		cancel() // the record was removed or taken: stop the lanes, never resurrect it
	}()
	o.sup.Supervise(ctx, plan.Children)
	cancel()
	<-beat
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

// keeperPlan is the plan this up hands over: its lanes, its environment, and
// itself as provisioner and, in the foreground (D7), as owner.
func (o *Orchestrator) keeperPlan(children []Child, isOwner bool) KeeperPlan {
	self := o.sys.Getpid()
	plan := KeeperPlan{
		Children: children, Env: os.Environ(), StartedAt: o.sys.Now(),
		ProvisionerPID: self, ProvisionerStart: o.sys.ProcessStart(self),
	}
	if isOwner {
		plan.OwnerPID, plan.OwnerStart = self, plan.ProvisionerStart
	}
	return plan
}

// handOver gives a provisioned stack to its keeper: write the plan, then ask
// the daemon, started first if none runs, to start `haven keep` (ruling
// D-S4c-1). The caller has stopped its heartbeat, so no beat overwrites the keeper's.
func (o *Orchestrator) handOver(ctx context.Context, st domain.Stack, plan KeeperPlan) error {
	if err := ignoreHavenState(st.WorktreeDir); err != nil {
		return fmt.Errorf("keeping .haven out of git: %w", err)
	}
	if err := writeKeeperPlan(keeperPlanPath(st.WorktreeDir, st.Slug), plan); err != nil {
		return fmt.Errorf("writing the keeper plan: %w", err)
	}
	if o.daemon == nil {
		return errors.New("no daemon client configured")
	}
	o.ensureDaemon(st.WorktreeDir)
	info, ok := o.store.Daemon()
	if !ok || !o.daemonAlive() {
		return errors.New("no haven daemon is running to start the keeper (see haven.log in the haven home)")
	}
	if err := o.daemon.StartKeeper(ctx, info.Port, st.Slug); err != nil {
		return fmt.Errorf("the daemon did not start the keeper: %w", err)
	}
	return nil
}

// StartKeeper is the daemon's half of the hand-over: it starts slug's keeper
// only while the plan's provisioner, alive, still holds the record, and
// returns once the keeper has taken it (race 1 in section 11.2 of the plan).
func (o *Orchestrator) StartKeeper(ctx context.Context, slug string) error {
	plan, err := o.ReadKeeperPlan(slug)
	if err != nil {
		return fmt.Errorf("stack %q has no readable keeper plan", slug)
	}
	if o.sem != nil {
		release, _, err := o.sem.Acquire(ctx, "up-"+slug, 1)
		if err != nil {
			return err
		}
		defer release()
	}
	st, ok := o.stackBySlug(slug)
	if !ok || st.LauncherPID != plan.ProvisionerPID || !o.launcherIsOurs(st) {
		return fmt.Errorf("stack %q is not waiting for a keeper", slug)
	}
	if err := o.spawnKeeper(st); err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, keeperHandover)
	defer cancel()
	err = o.awaitKeeper(ctx, slug, plan.ProvisionerPID)
	if errors.Is(err, context.DeadlineExceeded) {
		return fmt.Errorf("the keeper for %q did not take the stack within %s", slug, keeperHandover)
	}
	return err
}

// spawnKeeper starts `haven keep <slug>` in its own session, its output in the
// stack's combined log. The keeper replays the plan's environment itself.
func (o *Orchestrator) spawnKeeper(st domain.Stack) error {
	if len(o.cfg.KeepArgv) == 0 {
		return errors.New("no keeper command configured")
	}
	argv := append(append([]string{}, o.cfg.KeepArgv...), st.Slug, "--agent")
	_, combined := domain.StackLogPaths(st.WorktreeDir, st.Slug)
	if err := o.sys.SpawnDetached(argv, st.WorktreeDir, combined); err != nil {
		return fmt.Errorf("starting the keeper: %w", err)
	}
	return nil
}

// awaitKeeper waits until the record names a launcher that is ours and is not
// the provisioner, until ctx's deadline. A canceled ctx (Ctrl-C) returns at once (ruling R4).
func (o *Orchestrator) awaitKeeper(ctx context.Context, slug string, provisioner int) error {
	for {
		st, ok := o.stackBySlug(slug)
		if !ok {
			return fmt.Errorf("stack %q was torn down during the hand-over", slug)
		}
		if st.LauncherPID != provisioner && st.LauncherPID != 0 && o.launcherIsOurs(st) {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(50 * time.Millisecond):
		}
	}
}

// IsStackOwner is whether pid is the foreground up that owns slug's running
// stack (D7). Liveness only, no ps: the owner asks it on every follow tick.
func (o *Orchestrator) IsStackOwner(slug string, pid int) bool {
	st, ok := o.stackBySlug(slug)
	return ok && st.OwnerPID == pid && o.sys.ProcessAlive(st.LauncherPID)
}
