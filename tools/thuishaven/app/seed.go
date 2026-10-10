// The `haven seed` verb: drives cmd/seedgen against this worktree's stack, and the
// auto-seed an up runs once on a stack that was never seeded (design §9, Q7 a).
package app

import (
	"cmp"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/seedgen"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// seedTaskModule is the LANGWATCH_TASK_MODULES entry that gives `pnpm task` the seed:apply task.
const seedTaskModule = "@langwatch/seedgen-runner"

// autoSeedWait is how long an up's auto-seed is waited on before it carries on in the background.
var autoSeedWait = 60 * time.Second

// autoSeedArgs is Q7 (a): every kind once, four personas; no hybrid (the tiny tier has none).
var autoSeedArgs = []string{"--size", "tiny", "--persona", "all"}

// seedPresetArgs maps an old `haven db` preset to the seed that replaces its content (design §9.2).
// onboarding, post-onboarding and bare stay storage-seed switches.
var seedPresetArgs = map[string][]string{"demo": {"--size", "tiny", "--persona", "startup"}}

// SeedExit is a refusal or failure with the exit code `haven seed` ends with:
// 1 a check failed, 2 refused before writing, 4 stalled (design §9.2).
type SeedExit struct {
	Code int
	Err  error
}

func (e *SeedExit) Error() string { return e.Err.Error() }
func (e *SeedExit) Unwrap() error { return e.Err }

func refused(format string, args ...any) error {
	return &SeedExit{Code: 2, Err: fmt.Errorf(format, args...)}
}

// SeedRequest is one `haven seed`: the seedgen flags, already assembled, and whether it is live mode.
type SeedRequest struct {
	Args []string
	Live bool
	// JSON and Reveal shape the access block printed after a seed (SeedAccess).
	JSON, Reveal bool
}

// seedTarget is the stack a seed writes into and the environment seedgen's task child runs with.
type seedTarget struct {
	Slug, Dir string
	Env       []string
	IsAuto    bool
}

// seedStatus is what haven remembers of a stack's last seed, for `haven status` and `haven seed status`.
type seedStatus struct {
	State      string    `json:"state"` // running, done, failed, stalled or skipped
	Auto       bool      `json:"auto,omitempty"`
	Args       []string  `json:"args"`
	PID        int       `json:"pid"`
	StartedAt  time.Time `json:"startedAt"`
	FinishedAt time.Time `json:"finishedAt,omitzero"`
	Exit       int       `json:"exit,omitempty"`
	Reason     string    `json:"reason,omitempty"` // seedgen's own line saying why it failed
}

func (o *Orchestrator) seedStatusPath(slug string) string {
	return filepath.Join(o.cfg.Home, "seed", slug+".json")
}

func (o *Orchestrator) readSeedStatus(slug string) (seedStatus, bool) {
	data, err := os.ReadFile(o.seedStatusPath(slug))
	if err != nil {
		return seedStatus{}, false
	}
	var st seedStatus
	return st, json.Unmarshal(data, &st) == nil
}

func (o *Orchestrator) writeSeedStatus(slug string, st seedStatus) {
	path := o.seedStatusPath(slug)
	data, err := json.Marshal(st)
	if err == nil {
		err = os.MkdirAll(filepath.Dir(path), 0o750)
	}
	if err == nil {
		err = os.WriteFile(path+".tmp", data, 0o600)
	}
	if err == nil {
		err = os.Rename(path+".tmp", path)
	}
	if err != nil {
		o.log.Warn("could not record the seed status", zap.String("slug", slug), zap.Error(err))
	}
}

// seedRunsDir holds one directory per seedgen run on a stack: its manifest and checkpoint are
// the run record the access block (and the seed console) lists orgs from.
func (o *Orchestrator) seedRunsDir(slug string) string {
	return filepath.Join(o.cfg.Home, "seed", slug)
}

// ClearSeedStatus forgets a stack's seed and its run records, after `haven db reset` emptied its stores.
func (o *Orchestrator) ClearSeedStatus(slug string) {
	_ = os.Remove(o.seedStatusPath(slug))
	_ = os.RemoveAll(o.seedRunsDir(slug))
}

// SeedStatusLine is the one line `haven status` shows for a stack's seed, or "" when it never ran.
func (o *Orchestrator) SeedStatusLine(slug string) string {
	st, ok := o.readSeedStatus(slug)
	if !ok {
		return ""
	}
	state := st.State
	switch {
	case state == "running" && !o.sys.ProcessAlive(st.PID):
		state = "stalled (its haven process is gone; `haven seed` resumes by natural keys)"
	case state == "running":
		state = fmt.Sprintf("running for %s", o.sys.Now().Sub(st.StartedAt).Round(time.Second))
	case state == "done" || state == "failed":
		state = fmt.Sprintf("%s in %s (exit %d)", state, st.FinishedAt.Sub(st.StartedAt).Round(time.Second), st.Exit)
	}
	if st.Reason != "" {
		state += ": " + st.Reason
	}
	return fmt.Sprintf("seed: %s [%s]", state, strings.Join(st.Args, " "))
}

// SeedStatus is `haven seed status`.
func (o *Orchestrator) SeedStatus(p UpParams) error {
	slug, err := o.resolveSlug(p)
	if err != nil {
		return err
	}
	line := o.SeedStatusLine(slug)
	if line == "" {
		line = "seed: never ran on this stack (`haven seed` runs it)"
	}
	fmt.Println(line)
	return nil
}

// Seed is `haven seed`. Flags are validated before anything is touched; --dry-run writes nothing.
func (o *Orchestrator) Seed(ctx context.Context, p UpParams, req SeedRequest) error {
	flags, err := seedgen.ParseFlags(req.Args, o.sys.Now().UTC().Truncate(time.Hour))
	if err != nil {
		return refused("haven seed: %v", err)
	}
	plan, err := seedgen.NewPlan(flags)
	if err != nil {
		return refused("haven seed: %v", err)
	}
	if flags.DryRun {
		fmt.Printf("run %s, recipe %s, anchor %s, seed %d\n", plan.Run, seedgen.Recipe, flags.Anchor.Format(time.RFC3339), flags.Seed)
		plan.Estimate().Print(os.Stdout)
		return nil
	}
	slug, err := o.resolveSlug(p)
	if err != nil {
		return refused("haven seed: %v", err)
	}
	if req.Live {
		if _, ok := o.readSeedStatus(slug); !ok {
			return refused("haven seed --live needs a seed first: run `haven seed`")
		}
		return refused("haven seed --live: live mode is not built yet")
	}
	st, err := o.seedableStack(slug)
	if err != nil {
		return err
	}
	env := append(o.seedEnv(p), "DOTENV_CONFIG_QUIET=true")
	code := o.runSeedgen(ctx, seedTarget{Slug: slug, Dir: st.WorktreeDir, Env: env}, req.Args)
	if code != 0 {
		st, _ := o.readSeedStatus(slug)
		return &SeedExit{Code: code, Err: fmt.Errorf("haven seed: seedgen exited %d: %s", code,
			cmp.Or(st.Reason, "see `haven logs seed`"))}
	}
	return o.printSeedAccess(p, req.JSON, req.Reveal)
}

// seedableStack is the registered stack of slug, refused when its launcher or api is down.
func (o *Orchestrator) seedableStack(slug string) (domain.Stack, error) {
	reg, ok := o.stackBySlug(slug)
	if !ok || !o.launcherIsOurs(reg) {
		return domain.Stack{}, refused("haven seed: the stack %q is not up: run `haven up`", slug)
	}
	for _, svc := range reg.Services {
		if svc.Name == "api" && !o.sys.PortInUse(svc.Port) {
			return domain.Stack{}, refused("haven seed: the api of %q is down: run `haven up`", slug)
		}
	}
	return reg, nil
}

// runSeedgen runs `seedgen run` for t and keeps the status file; it returns seedgen's exit code.
func (o *Orchestrator) runSeedgen(ctx context.Context, t seedTarget, args []string) int {
	status := seedStatus{State: "running", Auto: t.IsAuto, Args: args, PID: o.sys.Getpid(), StartedAt: o.sys.Now()}
	o.writeSeedStatus(t.Slug, status)
	shell := "go run " + shellQuote(filepath.Join(t.Dir, "cmd", "seedgen")) + " run"
	for _, a := range o.runRecordArgs(t.Slug, args) {
		shell += " " + shellQuote(a)
	}
	env := append(append([]string{}, t.Env...), "LANGWATCH_TASK_MODULES="+seedTaskModule)
	env = append(env, o.licenceEnv(t.Slug, resolvedDevEnv(t.Dir), true)...)
	err := o.sup.RunOnce(ctx, "seed", t.Dir, shell, env)
	status.Exit, status.FinishedAt = exitCodeOf(err), o.sys.Now()
	if dir := o.seedRunDir(t.Slug, args); err != nil && dir != "" {
		reason, _ := os.ReadFile(filepath.Join(dir, seedgen.FailureFile))
		status.Reason = strings.TrimSpace(string(reason))
	}
	if status.Exit < 0 {
		status.Exit = 1
	}
	switch {
	case err == nil:
		status.State = "done"
	case status.Exit == 4:
		status.State = "stalled"
	case status.Exit == 2 && t.IsAuto:
		status.State = "skipped"
	default:
		status.State = "failed"
	}
	o.writeSeedStatus(t.Slug, status)
	return status.Exit
}

// runRecordArgs points seedgen at this stack's record of the run args plan; a run seen before
// resumes from its checkpoint, so seeding again sends nothing twice.
func (o *Orchestrator) runRecordArgs(slug string, args []string) []string {
	dir := o.seedRunDir(slug, args)
	if dir == "" {
		return args // seedgen refuses the same flags itself, with exit 2
	}
	record := append(slices.Clone(args), "--run-dir", dir)
	if _, err := os.Stat(filepath.Join(dir, "run.json")); err == nil {
		record = append(record, "--resume")
	}
	return record
}

// seedRunDir is this stack's record directory for the run args plan, "" when they plan nothing.
func (o *Orchestrator) seedRunDir(slug string, args []string) string {
	flags, err := seedgen.ParseFlags(args, o.sys.Now().UTC().Truncate(time.Hour))
	if err != nil || o.cfg.Home == "" {
		return ""
	}
	plan, err := seedgen.NewPlan(flags)
	if err != nil {
		return ""
	}
	return filepath.Join(o.seedRunsDir(slug), plan.Run)
}

// AutoSeed runs after an up's identity seed (design §9.1). It seeds a stack that was never seeded
// (or whose last auto-seed was skipped), waits at most autoSeedWait on it, then lets it finish in
// the background. A failure is said in one line and never stops the boot.
func (o *Orchestrator) AutoSeed(ctx context.Context, seed KeeperSeed) {
	if os.Getenv("HAVEN_AUTO_SEED") == "0" || o.cfg.Home == "" {
		return
	}
	job := seed.Job
	if prev, seen := o.readSeedStatus(job.Slug); seen && prev.State != "skipped" {
		return
	}
	sayPhase(seed.Since, "auto-seed: tiny tier, four personas")
	notice := time.AfterFunc(autoSeedWait, func() {
		sayPhase(seed.Since, "auto-seed continues in the background (`haven seed status`)")
	})
	defer notice.Stop()
	switch code := o.runSeedgen(ctx, seedTarget{Slug: job.Slug, Dir: job.WorktreeDir, Env: job.Env, IsAuto: true}, autoSeedArgs); code {
	case 0:
		sayPhase(seed.Since, "auto-seed done")
	case 2:
		sayPhase(seed.Since, "auto-seed skipped: seedgen refused to run (exit 2); `haven seed` retries")
	default:
		sayPhase(seed.Since, fmt.Sprintf("auto-seed failed (exit %d, continuing); `haven seed status`", code))
	}
}

// SeedPreset runs the seed an old `haven db` preset maps to; a preset with no mapping is a no-op.
func (o *Orchestrator) SeedPreset(ctx context.Context, p UpParams, preset string) error {
	args, ok := seedPresetArgs[preset]
	if !ok {
		return nil
	}
	err := o.Seed(ctx, p, SeedRequest{Args: args})
	if err != nil {
		return fmt.Errorf("%w — retry with: haven seed %s", err, strings.Join(args, " "))
	}
	return nil
}
