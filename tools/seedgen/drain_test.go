package seedgen

import (
	"bufio"
	"context"
	"strings"
	"sync"
	"testing"
	"time"
)

func drainPlan(t *testing.T) *Plan {
	t.Helper()
	plan, err := NewPlan(Flags{Size: "tiny", Spans: 40, Days: 1, Personas: []string{"startup"}, Seed: 7,
		Anchor: time.Date(2026, 10, 1, 0, 0, 0, 0, time.UTC), Shape: "saas"})
	if err != nil {
		t.Fatal(err)
	}
	return plan
}

// @scenario "The seed waits only for its own data to land"
func TestTheDrainWaitsForTheSeedsTenantsOnly(t *testing.T) {
	plan := drainPlan(t)
	var mu sync.Mutex
	reads, asked := 0, []string{}
	backlog := func(_ context.Context, tenants []string, _ time.Time) (SeedBacklog, error) {
		mu.Lock()
		defer mu.Unlock()
		reads++
		asked = tenants
		if reads < 3 {
			return SeedBacklog{Due: 5, Active: 1}, nil
		}
		return SeedBacklog{Deferred: 7}, nil
	}
	result, err := Run(context.Background(), RunConfig{Plan: plan, Executor: &fakeExecutor{sent: map[string]int{}},
		Checkpoint: NewCheckpoint(plan.Run, nil), Tick: time.Millisecond, Drain: true, Backlog: backlog})
	if err != nil || result.Deferred != 7 || reads != 4 {
		t.Fatalf("err %v, deferred %d, reads %d: want settled after two clean reads, 7 deferred", err, result.Deferred, reads)
	}
	for _, tenant := range asked {
		if !strings.HasPrefix(tenant, "id-$org:") && !strings.HasPrefix(tenant, "id-$project:") {
			t.Errorf("asked about %q, want only the seed's orgs and projects", tenant)
		}
	}
	blocked := func(context.Context, []string, time.Time) (SeedBacklog, error) { return SeedBacklog{Blocked: 2}, nil }
	_, err = Run(context.Background(), RunConfig{Plan: plan, Executor: &fakeExecutor{sent: map[string]int{}},
		Checkpoint: NewCheckpoint(plan.Run, nil), Tick: time.Millisecond, Drain: true, Backlog: blocked})
	if err == nil || !strings.Contains(err.Error(), "blocked 2") {
		t.Errorf("want a blocked group to fail the run naming it, got %v", err)
	}
}

// refusingExecutor refuses member.add as retryable and records whether a cell was sent before an
// identity action answered.
type refusingExecutor struct {
	fakeExecutor
	identityOpen int
	early        bool
}

func (f *refusingExecutor) Send(ctx context.Context, action Action) (Reply, error) {
	f.mu.Lock()
	isCell := action.Kind == KindTraceOTLP || action.Kind == KindLogOTLP || action.Kind == KindMetricOTLP
	if isCell && f.identityOpen > 0 {
		f.early = true
	}
	if !isCell {
		f.identityOpen++
	}
	f.mu.Unlock()
	time.Sleep(time.Millisecond)
	f.mu.Lock()
	if !isCell {
		f.identityOpen--
	}
	f.mu.Unlock()
	if action.Kind == KindMemberAdd {
		f.mu.Lock()
		f.sent[action.ID]++
		f.mu.Unlock()
		return Reply{ID: action.ID, Code: "authz_grant_not_confirmed", Retryable: true}, nil
	}
	reply, err := f.fakeExecutor.Send(ctx, action)
	if action.Kind == KindOrgCreate { // the product founds the org's main team with it
		reply.Refs["$team:"+strings.TrimPrefix(action.Ref, "$org:")+"/main"] = "id-team"
	}
	return reply, err
}

// @scenario "Identity lands before telemetry and a temporary refusal is retried"
func TestIdentityLandsBeforeTelemetryAndARefusalStaysUnacked(t *testing.T) {
	plan := drainPlan(t)
	executor := &refusingExecutor{fakeExecutor: fakeExecutor{sent: map[string]int{}}}
	checkpoint := NewCheckpoint(plan.Run, nil)
	result, err := Run(context.Background(), RunConfig{Plan: plan, Executor: executor, Checkpoint: checkpoint,
		Tick: time.Millisecond, Backoff: time.Microsecond})
	if err != nil || executor.early {
		t.Fatalf("err %v, cell sent while identity open: %v", err, executor.early)
	}
	for step := range plan.Steps() {
		if a := step.Action; a != nil && a.Kind == KindMemberAdd {
			if n := executor.sent[a.ID]; n != retries {
				t.Errorf("member.add %s sent %d times, want %d", a.ID, n, retries)
			}
			if checkpoint.Done(step.Seq) {
				t.Errorf("refused member.add %s was acked: a re-run would skip it", a.ID)
			}
		}
	}
	if result.IdentityRefused == 0 {
		t.Error("the refusals must still count, so the run exits 1")
	}
}

func TestReadRESPReadsNestedReplies(t *testing.T) {
	reply, err := readRESP(bufio.NewReader(strings.NewReader("*2\r\n$1\r\n0\r\n*2\r\n$3\r\nfoo\r\n:42\r\n")))
	parts, ok := reply.([]any)
	if err != nil || !ok || parts[0] != "0" {
		t.Fatalf("reply %#v, %v", reply, err)
	}
	inner, _ := parts[1].([]any)
	if len(inner) != 2 || inner[0] != "foo" || inner[1] != int64(42) {
		t.Errorf("inner %#v", inner)
	}
	if _, err := readRESP(bufio.NewReader(strings.NewReader("-WRONGTYPE nope\r\n"))); err == nil {
		t.Error("an error reply must be an error")
	}
}

// existingExecutor answers every project.create as found, not made.
type existingExecutor struct{ fakeExecutor }

func (f *existingExecutor) Send(ctx context.Context, action Action) (Reply, error) {
	reply, err := f.fakeExecutor.Send(ctx, action)
	reply.Existing = action.Kind == KindProjectCreate
	if action.Kind == KindOrgCreate {
		reply.Refs["$team:"+strings.TrimPrefix(action.Ref, "$org:")+"/main"] = "id-team"
	}
	return reply, err
}

// @scenario "Identity lands before telemetry and a temporary refusal is retried"
func TestARerunSendsNoTelemetryToAProjectAnEarlierRunMade(t *testing.T) {
	plan := drainPlan(t)
	executor := &existingExecutor{fakeExecutor{sent: map[string]int{}}}
	result, err := Run(context.Background(), RunConfig{Plan: plan, Executor: executor,
		Checkpoint: NewCheckpoint(plan.Run, nil), Tick: time.Millisecond})
	if err != nil || result.Spans != 0 || result.SkippedCells == 0 {
		t.Fatalf("err %v, %d spans sent, %d cells skipped: want no telemetry into found projects", err, result.Spans, result.SkippedCells)
	}
	for id := range executor.sent {
		if strings.Contains(id, ".") { // a chunk id is "<run>/<seq>.<k>"
			t.Errorf("chunk %s was sent into a project an earlier run made", id)
		}
	}
}
