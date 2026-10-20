package app

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/seedgen"
	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

var seedNow = time.Date(2026, 10, 9, 12, 0, 0, 0, time.UTC)

func seedOrchestrator(t *testing.T, sup *fakeSupervisor, stacks ...domain.Stack) *Orchestrator {
	t.Helper()
	sys := &fakeSystem{now: seedNow, alive: map[int]bool{1: true, 42: true}, portsInUse: map[int]bool{6560: true}}
	return &Orchestrator{
		cfg: Config{Home: t.TempDir(), Naming: domain.DefaultNaming("")},
		sup: sup, store: &fakeStore{stacks: stacks}, sys: sys, log: zap.NewNop(),
	}
}

func seedStack() domain.Stack {
	return domain.Stack{
		Slug: "feat-x", WorktreeDir: "/wt/feat-x", LauncherPID: 42,
		Services: []domain.Service{{Name: "api", Port: 6560}},
	}
}

func exit2Error(t *testing.T) error {
	t.Helper()
	err := exec.Command("sh", "-c", "exit 2").Run()
	if err == nil {
		t.Fatal("sh did not fail")
	}
	return err
}

// @scenario "Bad flags are refused before anything is written"
func TestSeedRefusesBadFlagsBeforeWriting(t *testing.T) {
	for _, args := range [][]string{{"--size", "huge"}, {"--days", "0"}, {"--persona", "nosuch"}} {
		t.Run(strings.Join(args, " "), func(t *testing.T) {
			sup := &fakeSupervisor{}
			o := seedOrchestrator(t, sup, seedStack())
			err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: args})
			var exit *SeedExit
			if !errors.As(err, &exit) || exit.Code != 2 {
				t.Fatalf("err = %v, want exit 2", err)
			}
			if !strings.Contains(err.Error(), strings.TrimPrefix(args[0], "--")) {
				t.Errorf("err %q does not name the flag %s", err, args[0])
			}
			if len(sup.shells) != 0 {
				t.Errorf("ran %v, want nothing written", sup.shells)
			}
			if _, ok := o.readSeedStatus("feat-x"); ok {
				t.Error("a status file was written")
			}
		})
	}
}

// @scenario "haven db seed refuses a stack that is not up"
func TestSeedRefusesAStackThatIsNotUp(t *testing.T) {
	t.Run("given no registered stack", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(t, sup)
		err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{})
		var exit *SeedExit
		if !errors.As(err, &exit) || exit.Code != 2 || !strings.Contains(err.Error(), "haven up") {
			t.Fatalf("err = %v, want exit 2 naming haven up", err)
		}
		if len(sup.shells) != 0 {
			t.Errorf("ran %v", sup.shells)
		}
	})
	t.Run("given an api that is not listening", func(t *testing.T) {
		sup := &fakeSupervisor{}
		o := seedOrchestrator(t, sup, seedStack())
		o.sys.(*fakeSystem).portsInUse = nil
		err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{})
		if err == nil || !strings.Contains(err.Error(), "api") || !strings.Contains(err.Error(), "haven up") {
			t.Fatalf("err = %v, want the api named", err)
		}
	})
}

func TestSeedDrivesSeedgenAgainstTheStack(t *testing.T) {
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup, seedStack())
	args := []string{"--size", "small", "--days", "30", "--persona", "startup,enterprise", "--seed", "7"}
	if err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: args}); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "/wt/feat-x/cmd/seedgen' run '--size' 'small'") {
		t.Fatalf("shells = %v", sup.shells)
	}
	if !strings.Contains(strings.Join(sup.envs[0], " "), "LANGWATCH_TASK_MODULES=/wt/feat-x/tools/seedgen/runner/src/index.ts") {
		t.Error("the task child is not told to load the runner")
	}
	if line := o.SeedStatusLine("feat-x"); !strings.Contains(line, "done") {
		t.Errorf("status line = %q", line)
	}
	if !strings.Contains(sup.shells[0], "'--run-dir' '"+o.seedRunsDir("feat-x")+"/") || strings.Contains(sup.shells[0], "--resume") {
		t.Errorf("the first run is not recorded under the stack: %s", sup.shells[0])
	}
}

// @scenario "Seeding again with the same seed adds nothing"
func TestSeedingAgainResumesTheRunRecord(t *testing.T) {
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup, seedStack())
	args := []string{"--size", "tiny", "--seed", "7"}
	record := o.runRecordArgs("feat-x", args, time.Time{})
	dir := record[len(record)-1]
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "run.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if again := o.runRecordArgs("feat-x", args, time.Time{}); again[len(again)-1] != "--resume" {
		t.Fatalf("a recorded run is not resumed: %v", again)
	}
}

func TestSeedDryRunWritesNothing(t *testing.T) {
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup)
	if err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: []string{"--size", "medium", "--dry-run"}}); err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if len(sup.shells) != 0 {
		t.Errorf("ran %v", sup.shells)
	}
}

func TestSeedLiveNeedsASeedFirst(t *testing.T) {
	o := seedOrchestrator(t, &fakeSupervisor{}, seedStack())
	err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Live: true})
	var exit *SeedExit
	if !errors.As(err, &exit) || exit.Code != 2 || !strings.Contains(err.Error(), "haven db seed") {
		t.Fatalf("err = %v, want exit 2 asking for a seed first", err)
	}
}

func autoSeedJob(slug string) KeeperSeed {
	return KeeperSeed{Job: onceJob{Slug: slug, WorktreeDir: "/wt/" + slug, Env: []string{"A=1"}}, Since: seedNow}
}

// @scenario "The auto-seed can be turned off"
func TestAutoSeedCanBeTurnedOff(t *testing.T) {
	t.Setenv("HAVEN_AUTO_SEED", "0")
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup)
	o.AutoSeed(context.Background(), autoSeedJob("feat-x"))
	if len(sup.shells) != 0 {
		t.Errorf("ran %v with HAVEN_AUTO_SEED=0", sup.shells)
	}
}

func TestAutoSeedSeedsOnceWithTheTinyTier(t *testing.T) {
	t.Setenv("HAVEN_AUTO_SEED", "")
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup)
	o.AutoSeed(context.Background(), autoSeedJob("feat-x"))
	o.AutoSeed(context.Background(), autoSeedJob("feat-x"))
	if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "'--size' 'tiny' '--persona' 'all'") {
		t.Fatalf("shells = %v, want one tiny all-persona run", sup.shells)
	}
}

func TestAutoSeedSkipsWhenSeedgenRefusesAndRetriesNextUp(t *testing.T) {
	t.Setenv("HAVEN_AUTO_SEED", "")
	sup := &fakeSupervisor{err: exit2Error(t)}
	o := seedOrchestrator(t, sup)
	o.AutoSeed(context.Background(), autoSeedJob("feat-x"))
	st, _ := o.readSeedStatus("feat-x")
	if st.State != "skipped" || st.Exit != 2 {
		t.Fatalf("status = %+v, want skipped with exit 2", st)
	}
	sup.err = nil
	o.AutoSeed(context.Background(), autoSeedJob("feat-x"))
	if st, _ = o.readSeedStatus("feat-x"); st.State != "done" {
		t.Errorf("status = %+v, want done after the retry", st)
	}
}

// @scenario "haven up does not wait past a minute for the auto-seed"
func TestAutoSeedDoesNotHoldTheUpPastTheWait(t *testing.T) {
	t.Setenv("HAVEN_AUTO_SEED", "")
	previous := autoSeedWait
	autoSeedWait = 10 * time.Millisecond
	t.Cleanup(func() { autoSeedWait = previous })
	sup := &blockingSupervisor{release: make(chan struct{}), started: make(chan struct{})}
	o := seedOrchestrator(t, &fakeSupervisor{})
	o.sup = sup
	done := make(chan struct{})
	go func() { o.AutoSeed(context.Background(), autoSeedJob("feat-x")); close(done) }()
	<-sup.started
	time.Sleep(50 * time.Millisecond)
	if line := o.SeedStatusLine("feat-x"); !strings.Contains(line, "running") {
		t.Errorf("status line = %q, want the seed running in the background", line)
	}
	close(sup.release)
	<-done
	if line := o.SeedStatusLine("feat-x"); !strings.Contains(line, "done") {
		t.Errorf("status line = %q, want done", line)
	}
}

type blockingSupervisor struct {
	fakeSupervisor
	release, started chan struct{}
}

func (b *blockingSupervisor) RunOnce(context.Context, string, string, string, []string) error {
	close(b.started)
	<-b.release
	return nil
}

// @scenario "The demo preset seeds the startup persona at the tiny tier"
func TestSeedPresetMapsDemoToTheStartupPersona(t *testing.T) {
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup, seedStack())
	p := UpParams{ExplicitSlug: "feat-x"}
	if err := o.SeedPreset(context.Background(), p, "bare"); err != nil || len(sup.shells) != 0 {
		t.Fatalf("bare: err %v, shells %v; want a no-op", err, sup.shells)
	}
	if err := o.SeedPreset(context.Background(), p, "demo"); err != nil {
		t.Fatalf("demo: %v", err)
	}
	if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "'--size' 'tiny' '--persona' 'startup'") {
		t.Fatalf("shells = %v", sup.shells)
	}
}

// @scenario "A failed seed says why on its last line"
func TestAFailedSeedNamesSeedgensReason(t *testing.T) {
	sup := &fakeSupervisor{err: exit2Error(t)}
	o := seedOrchestrator(t, sup, seedStack())
	args := []string{"--size", "small"}
	dir := o.seedRunDir("feat-x", args, time.Time{})
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, seedgen.FailureFile), []byte("the api answered 500\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: args})
	if err == nil || !strings.HasSuffix(err.Error(), ": the api answered 500") {
		t.Fatalf("err = %v, want it to end with seedgen's reason", err)
	}
	if line := o.SeedStatusLine("feat-x"); !strings.Contains(line, "failed") || !strings.Contains(line, "the api answered 500") {
		t.Errorf("status line = %q, want the failure and its reason", line)
	}
}

// @scenario "A seed that stays paused stops with a checkpoint and resumes later"
func TestAStalledSeedIsReportedAsStalled(t *testing.T) {
	sup := &fakeSupervisor{err: exit2Error(t)}
	o := seedOrchestrator(t, sup, seedStack())
	args := []string{"--size", "small"}
	dir := o.seedRunDir("feat-x", args, time.Time{})
	if err := os.MkdirAll(dir, 0o750); err != nil {
		t.Fatal(err)
	}
	line := "stalled: worker backlog held sending paused; the checkpoint is saved, resume with --resume"
	if err := os.WriteFile(filepath.Join(dir, seedgen.FailureFile), []byte(line+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: args})
	var exit *SeedExit
	if !errors.As(err, &exit) || exit.Code != 4 || !strings.HasSuffix(err.Error(), line) {
		t.Fatalf("err = %v, want exit 4 ending with seedgen's message", err)
	}
	if st, _ := o.readSeedStatus("feat-x"); st.State != "stalled" || st.Exit != 4 {
		t.Errorf("status = %+v, want stalled with exit 4", st)
	}
}

// writeRun records a run of args under the stack with the given anchor, as seedgen leaves it.
func writeRun(t *testing.T, o *Orchestrator, args []string, anchor time.Time) string {
	t.Helper()
	flags, err := seedgen.ParseFlags(args, anchor)
	if err != nil {
		t.Fatal(err)
	}
	plan, err := seedgen.NewPlan(flags)
	if err != nil {
		t.Fatal(err)
	}
	dir := filepath.Join(o.seedRunsDir("feat-x"), plan.Run)
	if err := seedgen.NewManifest(plan).Write(dir); err != nil {
		t.Fatal(err)
	}
	if err := seedgen.NewCheckpoint(plan.Run, nil).Save(filepath.Join(dir, "run.json")); err != nil {
		t.Fatal(err)
	}
	return dir
}

// @scenario "A resume keeps the run id of the last run"
func TestResumeKeepsTheLastRunsAnchor(t *testing.T) {
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup, seedStack())
	args := []string{"--size", "tiny", "--age", "2d"}
	earlier := seedNow.Add(-3 * time.Hour)
	dir := writeRun(t, o, args, earlier)

	err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: args, Resume: true})
	if err != nil {
		t.Fatalf("Seed: %v", err)
	}
	if len(sup.shells) != 1 || !strings.Contains(sup.shells[0], "'--run-dir' '"+dir+"' '--resume'") {
		t.Fatalf("shells = %v, want the earlier run's directory resumed", sup.shells)
	}
	if again := o.runRecordArgs("feat-x", args, time.Time{}); strings.Contains(strings.Join(again, " "), dir) {
		t.Fatalf("without --resume the new hour should plan a new run: %v", again)
	}
}

func TestResumeWithoutAnEarlierRunIsRefused(t *testing.T) {
	sup := &fakeSupervisor{}
	o := seedOrchestrator(t, sup, seedStack())
	writeRun(t, o, []string{"--size", "tiny"}, seedNow)
	err := o.Seed(context.Background(), UpParams{ExplicitSlug: "feat-x"}, SeedRequest{Args: []string{"--size", "small"}, Resume: true})
	var exit *SeedExit
	if !errors.As(err, &exit) || exit.Code != 2 || len(sup.shells) != 0 {
		t.Fatalf("err = %v, shells = %v, want exit 2 and no run", err, sup.shells)
	}
}

// @scenario "The access block lists every seeded org and its logins"
func TestSeedAccessListsAnOrgOnceAcrossRuns(t *testing.T) {
	o := seedOrchestrator(t, &fakeSupervisor{}, seedStack())
	args := []string{"--size", "tiny", "--private", "0", "--org", "name=acme,users=2"}
	for i, id := range []string{"org_old", "org_new"} {
		anchor := seedNow.Add(time.Duration(i) * time.Hour)
		dir := writeRun(t, o, args, anchor)
		flags, _ := seedgen.ParseFlags(args, anchor)
		plan, _ := seedgen.NewPlan(flags)
		refs := seedgen.Refs{plan.Orgs[0].Ref: id, plan.Orgs[0].Users[0].Ref: "user_" + id}
		if err := seedgen.NewCheckpoint(plan.Run, refs).Save(filepath.Join(dir, "run.json")); err != nil {
			t.Fatal(err)
		}
		when := seedNow.Add(time.Duration(i) * time.Minute)
		if err := os.Chtimes(dir, when, when); err != nil {
			t.Fatal(err)
		}
	}
	access, err := o.seedAccess(UpParams{ExplicitSlug: "feat-x"}, false)
	if err != nil {
		t.Fatalf("seedAccess: %v", err)
	}
	if len(access.Orgs) != 1 || access.Orgs[0].ID != "org_new" {
		t.Fatalf("orgs = %+v, want acme once, from the newest run", access.Orgs)
	}
}

// @scenario "Destroying a stack forgets its seeded logins"
func TestDestroyForgetsTheSeedRecords(t *testing.T) {
	o := seedOrchestrator(t, &fakeSupervisor{}, seedStack())
	writeRun(t, o, []string{"--size", "tiny"}, seedNow)
	o.writeSeedStatus("feat-x", seedStatus{State: "done"})
	o.ClearSeedStatus("feat-x")
	if _, ok := o.readSeedStatus("feat-x"); ok {
		t.Error("the seed status survived")
	}
	if entries, _ := os.ReadDir(o.seedRunsDir("feat-x")); len(entries) != 0 {
		t.Errorf("run records survived: %v", entries)
	}
}
