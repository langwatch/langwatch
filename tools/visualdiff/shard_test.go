package visualdiff

import (
	"context"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"sync/atomic"
	"syscall"
	"testing"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

func TestParseShardReadsIndexOverCount(t *testing.T) {
	shard, err := ParseShard("3/8")
	if err != nil || shard != (Shard{Index: 3, Count: 8}) || shard.String() != "3/8" {
		t.Fatalf("ParseShard(3/8) = %+v, %v", shard, err)
	}
	if whole, err := ParseShard(""); err != nil || whole.Sharded() || !whole.OwnsCoverage() {
		t.Fatalf("an empty -shard is the whole run, got %+v, %v", whole, err)
	}
	for _, bad := range []string{"0/8", "9/8", "3", "a/b", "1/0", "-1/2"} {
		if _, err := ParseShard(bad); err == nil {
			t.Errorf("ParseShard(%q) accepted", bad)
		}
	}
}

// The shards of the real configuration are disjoint and together are everything.
// @scenario "A sharded run renders every route and flow exactly once across its shards"
func TestShardsOfTheConfigurationAreDisjointAndCoverEverything(t *testing.T) {
	config, err := LoadConfig(filepath.Join("..", "..", ConfigFile))
	if err != nil {
		t.Fatal(err)
	}
	const count = 8
	routes, flows := map[string]int{}, map[string]int{}
	for index := 1; index <= count; index++ {
		sharded := Shard{Index: index, Count: count}.Apply(config)
		if len(sharded.DeclaredRoutes()) != len(config.Routes) {
			t.Fatalf("shard %d narrowed the declared routes coverage reads", index)
		}
		for _, route := range sharded.Routes {
			routes[route]++
		}
		for _, flow := range sharded.Flows {
			flows[flow.ID]++
		}
		if size := len(sharded.Flows); size < len(config.Flows)/count || size > len(config.Flows)/count+1 {
			t.Errorf("shard %d holds %d of %d flows, not an even share", index, size, len(config.Flows))
		}
	}
	assertEachOnce(t, "route", routes, len(config.Routes))
	assertEachOnce(t, "flow", flows, len(config.Flows))
}

func assertEachOnce(t *testing.T, kind string, seen map[string]int, total int) {
	t.Helper()
	if len(seen) != total {
		t.Errorf("%d distinct %ss over the shards, want %d", len(seen), kind, total)
	}
	for name, times := range seen {
		if times != 1 {
			t.Errorf("%s %s runs in %d shards", kind, name, times)
		}
	}
}

func TestOnlyTheFirstShardOwnsCoverage(t *testing.T) {
	if !(Shard{Index: 1, Count: 4}).OwnsCoverage() || (Shard{Index: 2, Count: 4}).OwnsCoverage() {
		t.Fatal("coverage belongs to shard 1 alone")
	}
}

func TestDeadlineStopsTheRunnerAsPartial(t *testing.T) {
	command := exec.Command("sleep", "30")
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		t.Skip("no sleep to stop:", err)
	}
	var stopped atomic.Pointer[diffkit.Stopped]
	cancel := stopAtDeadline(time.Now().Add(50*time.Millisecond), command, &stopped)
	defer cancel()
	done := make(chan error, 1)
	go func() { done <- command.Wait() }()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		_ = command.Process.Kill()
		t.Fatal("the deadline did not stop the runner")
	}
	if reason := stopped.Load(); reason == nil || reason.Reason != DeadlineReason {
		t.Fatalf("stopped = %v, want the deadline", reason)
	}
}

func TestNoDeadlineNeverStops(t *testing.T) {
	var stopped atomic.Pointer[diffkit.Stopped]
	stopAtDeadline(time.Time{}, nil, &stopped)()
	if stopped.Load() != nil {
		t.Fatal("a zero deadline stopped the run")
	}
}

// A run stopped at its -deadline still writes its report, exits on its
// findings, and its summary and outcome say it is partial.
// @scenario "A run stopped at its deadline reports what it captured as partial"
func TestADeadlineStopReportsWhatWasCapturedAsPartial(t *testing.T) {
	captures := []Capture{{Kind: "route", Key: "/settings", Side: "base"}, {Kind: "route", Key: "/settings", Side: "candidate"}}
	deps := passingDeps(&fakeRunner{}, nil, nil)
	deps.Capture = func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
		return RunnerStream{Captures: captures}, &diffkit.Stopped{Reason: DeadlineReason}
	}
	options := testOptions(t)
	options.Shard = Shard{Index: 2, Count: 2}

	result, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: io.Discard})

	if err != nil || ExitCode(result, err) == ExitOperational || len(result.Rows) != 1 {
		t.Fatalf("result %+v, err %v: a deadline is not a broken run", result, err)
	}
	summary, _ := os.ReadFile(filepath.Join(options.RunDir, SummaryFile))
	mustContain(t, string(summary), "PARTIAL RUN")
	outcome, found, err := ReadOutcome(options.RunDir)
	if err != nil || !found || !outcome.Finished || outcome.Shard != "2/2" || len(outcome.Partial) != 1 || outcome.Coverage != nil {
		t.Fatalf("outcome %+v, %v, %v", outcome, found, err)
	}
}
