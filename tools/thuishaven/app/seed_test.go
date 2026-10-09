package app

import (
	"context"
	"errors"
	"os/exec"
	"strings"
	"testing"
	"time"

	"go.uber.org/zap"

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

// @scenario "haven seed refuses a stack that is not up"
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
	if !strings.Contains(strings.Join(sup.envs[0], " "), "LANGWATCH_TASK_MODULES=@langwatch/seedgen-runner") {
		t.Error("the task child is not told to load the runner")
	}
	if line := o.SeedStatusLine("feat-x"); !strings.Contains(line, "done") {
		t.Errorf("status line = %q", line)
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
	if !errors.As(err, &exit) || exit.Code != 2 || !strings.Contains(err.Error(), "haven seed") {
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
