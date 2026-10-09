package app

import (
	"context"
	"os"
	"path/filepath"
	"reflect"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"go.uber.org/zap"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// recordingSupervisor logs when each shell starts and ends, and holds any shell
// named in hold until its channel closes.
type recordingSupervisor struct {
	Supervisor
	mu     sync.Mutex
	events []string
	hold   map[string]chan struct{}
}

func (s *recordingSupervisor) RunOnce(ctx context.Context, _, _, shell string, _ []string) error {
	s.record("start " + shell)
	if gate, ok := s.hold[shell]; ok {
		select {
		case <-gate:
		case <-ctx.Done():
			return ctx.Err()
		}
	}
	s.record("end " + shell)
	return nil
}

func (s *recordingSupervisor) record(event string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.events = append(s.events, event)
}

func (s *recordingSupervisor) seen() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.events...)
}

// @scenario "Lint and typecheck queue against the same counter"
func TestLintWaitsForARunningTypecheckOnTheSameCounter(t *testing.T) {
	const typecheck, lint = "pnpm typecheck worker", "pnpm lint apps/worker"
	// Two orchestrators over one slot directory: the typecheck and the lint are
	// separate haven processes that only the machine-wide counter ties together.
	o, sem := sharedRunOrch(t)
	other := runOrch(&fakeStore{}, nil)
	other.sem, other.cfg.CheckEnv = sem, o.cfg.CheckEnv
	release := make(chan struct{})
	sup := &recordingSupervisor{hold: map[string]chan struct{}{typecheck: release}}
	o.sup, other.sup = sup, sup
	ctx := context.Background()

	typecheckDone := make(chan error, 1)
	go func() { typecheckDone <- o.RunHeavy(ctx, HeavyRun{Shell: typecheck}) }()
	waitFor(t, func() bool { return len(sup.seen()) == 1 })

	lintDone := make(chan error, 1)
	go func() { lintDone <- other.RunHeavy(ctx, HeavyRun{Shell: lint}) }()
	time.Sleep(400 * time.Millisecond)
	if got := sup.seen(); !reflect.DeepEqual(got, []string{"start " + typecheck}) {
		t.Fatalf("with the limit at 1 the lint must wait for the typecheck, saw %v", got)
	}

	close(release)
	for _, done := range []chan error{typecheckDone, lintDone} {
		select {
		case err := <-done:
			if err != nil {
				t.Fatal(err)
			}
		case <-time.After(10 * time.Second):
			t.Fatal("a run never finished")
		}
	}
	want := []string{"start " + typecheck, "end " + typecheck, "start " + lint, "end " + lint}
	if got := sup.seen(); !reflect.DeepEqual(got, want) {
		t.Fatalf("events = %v, want the two never overlapping: %v", got, want)
	}
}

func waitFor(t *testing.T, ok func() bool) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for !ok() {
		if time.Now().After(deadline) {
			t.Fatal("condition never held")
		}
		time.Sleep(10 * time.Millisecond)
	}
}

// @scenario "A modular stack boots without a migration step"
func TestUpRunsNoMigrationBeforeTheServicesBoot(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "node_modules"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "pnpm-lock.yaml"), []byte("lockfileVersion: '9.0'\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "node_modules", ".modules.yaml"), []byte("{}\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	sup := &fakeSupervisor{}
	o := &Orchestrator{sup: sup, sys: &fakeSystem{now: time.Now()}, store: &fakeStore{}, log: zap.NewNop()}

	st := domain.Stack{Slug: "feat-x", WorktreeDir: root, Layout: domain.LayoutModular, APIPort: 6560, PostgresPort: 5432, PostgresDatabase: "feat_x"}
	seed, err := o.prepareWorktree(context.Background(), UpParams{WorktreeDir: root}, st)
	if err != nil {
		t.Fatalf("prepareWorktree: %v", err)
	}
	for _, shell := range sup.shells {
		if strings.Contains(shell, "start:prepare:db") || strings.Contains(shell, "task upgrade") || strings.Contains(shell, "prisma:seed") {
			t.Errorf("the up ran %q before boot; the worker runs the upgrade and the keeper seeds after it", shell)
		}
	}
	if !slices.ContainsFunc(sup.shells, func(s string) bool { return strings.Contains(s, "ensure:built") }) {
		t.Errorf("ran %v, want the dist packages the lanes import built before boot", sup.shells)
	}
	if seed == nil {
		t.Fatal("no seed was handed to the keeper")
	}
	if seed.ReadyURL != "http://127.0.0.1:6560/readyz" {
		t.Errorf("the seed waits on %q, want the api's readiness probe", seed.ReadyURL)
	}
	if !strings.Contains(seed.Job.Shell, "prisma:seed") {
		t.Errorf("the keeper's seed runs %q, want the checkout's seed script", seed.Job.Shell)
	}
}
