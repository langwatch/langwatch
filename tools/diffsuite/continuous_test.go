package diffsuite

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
	"time"
)

// fakeClock never waits: sleeping moves its time on and records the sleep.
type fakeClock struct {
	at     time.Time
	sleeps []time.Duration
}

func (f *fakeClock) clock() clock {
	return clock{
		now: func() time.Time { return f.at },
		sleep: func(ctx context.Context, d time.Duration) error {
			f.sleeps = append(f.sleeps, d)
			f.at = f.at.Add(d)
			return ctx.Err()
		},
	}
}

type harness struct {
	t      *testing.T
	clock  *fakeClock
	out    string
	said   []string
	loads  []float64
	runs   []outcome
	starts []time.Time
	cancel context.CancelFunc
}

// session runs the loop for j until the scripted runs are used up.
func (h *harness) play(j job) *session {
	ctx, cancel := context.WithCancel(context.Background())
	h.cancel = cancel
	s := &session{
		out: h.out, clock: h.clock.clock(), loadMax: 4,
		say:     func(format string, args ...any) { h.said = append(h.said, fmt.Sprintf(format, args...)) },
		ready:   func(context.Context) error { return nil },
		prepare: func(context.Context, string) (string, error) { return "abc123", nil },
		load: func() float64 {
			load := h.loads[0]
			if len(h.loads) > 1 {
				h.loads = h.loads[1:]
			}
			return load
		},
		run: func(_ context.Context, _, dir string) outcome {
			h.starts = append(h.starts, h.clock.at)
			result := h.runs[0]
			h.runs = h.runs[1:]
			h.clock.at = h.clock.at.Add(5 * time.Minute)
			if len(h.runs) == 0 {
				cancel()
			}
			return result
		},
	}
	s.loop(ctx, j)
	return s
}

func newHarness(t *testing.T, runs ...outcome) *harness {
	return &harness{t: t, out: t.TempDir(), clock: &fakeClock{at: time.Unix(1_000_000, 0)}, loads: []float64{0}, runs: runs}
}

func failing(pass int, ids ...string) outcome {
	return outcome{Pass: pass, Fail: len(ids), Failing: ids}
}

func (h *harness) latest(name string) summary {
	h.t.Helper()
	var got summary
	body, err := os.ReadFile(filepath.Join(h.out, name, "latest.json"))
	if err != nil || json.Unmarshal(body, &got) != nil {
		h.t.Fatalf("latest.json: %v", err)
	}
	return got
}

func TestDeltaListsNewAndFixedIds(t *testing.T) {
	added, fixed := delta([]string{"FAIL a", "FAIL b"}, []string{"FAIL b", "FAIL c", "FAIL d"})
	if !slices.Equal(added, []string{"FAIL c", "FAIL d"}) || !slices.Equal(fixed, []string{"FAIL a"}) {
		t.Fatalf("added %v fixed %v", added, fixed)
	}
}

func TestBackToBackIterationsReportTheDeltaAgainstThePreviousOne(t *testing.T) {
	h := newHarness(t, failing(2400, "FAIL a", "FAIL b", "FAIL c"), failing(2410, "FAIL b", "FAIL d"))
	h.play(job{name: "api"})
	last := h.latest("api")
	if last.Iteration != 2 || last.Baseline != 1 || !slices.Equal(last.New, []string{"FAIL d"}) ||
		!slices.Equal(last.Fixed, []string{"FAIL a", "FAIL c"}) || last.Commit != "abc123" {
		t.Fatalf("latest %+v", last)
	}
	said := strings.Join(h.said, "\n")
	for _, want := range []string{
		"[api] #1 DONE 2400 pass 3 fail (no earlier iteration to compare) at abc123",
		"[api] #2 DONE 2410 pass 2 fail (Δ -1 fail vs #1) at abc123",
		"[api] #2 new (1): FAIL d",
		"[api] #2 fixed (2): FAIL a; FAIL c",
	} {
		if !strings.Contains(said, want) {
			t.Errorf("missing %q in\n%s", want, said)
		}
	}
	if gap := h.starts[1].Sub(h.starts[0]); gap != 5*time.Minute {
		t.Errorf("back to back should start as the last ended, gap %v", gap)
	}
}

func TestBackToBackWaitsOnlyForTheMinimumGap(t *testing.T) {
	h := newHarness(t, failing(1), failing(1))
	h.play(job{name: "api"})
	if len(h.clock.sleeps) != 0 {
		t.Fatalf("a 5m iteration is longer than the %v gap, sleeps %v", minGap, h.clock.sleeps)
	}
}

func TestPeriodicToolStartsEveryPeriodAndWaitsForLoad(t *testing.T) {
	h := newHarness(t, failing(1), failing(1))
	h.loads = []float64{1, 9, 8, 1}
	h.play(job{name: "visual", every: 30 * time.Minute})
	if len(h.starts) != 2 {
		t.Fatalf("starts %v", h.starts)
	}
	if gap := h.starts[1].Sub(h.starts[0]); gap != 30*time.Minute+2*loadPoll {
		t.Errorf("start-to-start %v: a 30m period, then two load polls (9 and 8 are over 4)", gap)
	}
	waiting := 0
	for _, line := range h.said {
		if strings.Contains(line, "WAITING") {
			waiting++
		}
	}
	if waiting != 1 {
		t.Errorf("WAITING should print once per wait, got %d in %v", waiting, h.said)
	}
}

func TestStoppedIterationIsNotTheBaseline(t *testing.T) {
	h := newHarness(t, failing(5, "FAIL a"), outcome{Exit: 3, Stopped: "sign-in refused", Failing: []string{}}, failing(5, "FAIL a"))
	h.play(job{name: "api"})
	last := h.latest("api")
	if last.Iteration != 3 || last.Baseline != 1 || len(last.New) != 0 || len(last.Fixed) != 0 {
		t.Fatalf("a stopped #2 must not make #3 look like a fix, latest %+v", last)
	}
	if !strings.Contains(strings.Join(h.said, "\n"), "[api] #2 STOPPED (sign-in refused) at abc123") {
		t.Errorf("said %v", h.said)
	}
}

func TestOnlyTheNewestTwoIterationsStayAndNumbersContinue(t *testing.T) {
	h := newHarness(t, failing(1), failing(1), failing(1), failing(1))
	toolDir := filepath.Join(h.out, "api")
	for _, old := range []string{"0007", "0008"} {
		os.MkdirAll(filepath.Join(toolDir, old), 0o755)
	}
	h.play(job{name: "api"})
	left := iterations(toolDir)
	if !slices.Equal(left, []int{11, 12}) {
		t.Fatalf("kept %v, want [11 12]", left)
	}
	if h.latest("api").Iteration != 12 {
		t.Fatalf("latest %+v", h.latest("api"))
	}
}

func TestRestartComparesWithTheLatestJsonOfTheSession(t *testing.T) {
	h := newHarness(t, failing(9, "FAIL a"))
	h.play(job{name: "api"})
	h.runs, h.clock.at = []outcome{failing(9)}, h.clock.at.Add(time.Hour)
	h.play(job{name: "api"})
	last := h.latest("api")
	if last.Iteration != 2 || last.Baseline != 1 || !slices.Equal(last.Fixed, []string{"FAIL a"}) {
		t.Fatalf("latest %+v", last)
	}
}

func TestBuildFailureRetriesAfterTheGapWithoutRunning(t *testing.T) {
	h := newHarness(t)
	calls := 0
	ctx, cancel := context.WithCancel(context.Background())
	s := &session{
		out: h.out, clock: h.clock.clock(), loadMax: 4,
		say:   func(format string, args ...any) { h.said = append(h.said, fmt.Sprintf(format, args...)) },
		ready: func(context.Context) error { return nil },
		prepare: func(context.Context, string) (string, error) {
			if calls++; calls == 1 {
				return "", fmt.Errorf("boom")
			}
			cancel()
			return "def456", nil
		},
		load: func() float64 { return 0 },
		run:  func(context.Context, string, string) outcome { return failing(1) },
	}
	s.loop(ctx, job{name: "api"})
	if h.latest("api").Iteration != 1 || !slices.Equal(h.clock.sleeps, []time.Duration{minGap}) {
		t.Fatalf("iteration %d sleeps %v said %v", h.latest("api").Iteration, h.clock.sleeps, h.said)
	}
}

func TestGateSaysStackDownOnceAfterTwoMinutesAndUpOnRecovery(t *testing.T) {
	f := &fakeClock{at: time.Unix(0, 0)}
	var said []string
	answers := 0
	g := &gate{
		clock: f.clock(),
		say:   func(format string, args ...any) { said = append(said, fmt.Sprintf(format, args...)) },
		probe: func() bool { answers++; return answers > 12 },
	}
	if err := g.wait(context.Background()); err != nil {
		t.Fatal(err)
	}
	if len(said) != 2 || !strings.HasPrefix(said[0], "[suite] STACK DOWN") || said[1] != "[suite] STACK UP" {
		t.Fatalf("said %v", said)
	}
	if total := f.at.Sub(time.Unix(0, 0)); total != 12*healthEvery {
		t.Errorf("waited %v", total)
	}
}

func TestGateDoesNotSayStackDownInsideTheGrace(t *testing.T) {
	f := &fakeClock{at: time.Unix(0, 0)}
	var said []string
	answers := 0
	g := &gate{clock: f.clock(), say: func(format string, args ...any) { said = append(said, format) },
		probe: func() bool { answers++; return answers > 3 }}
	if err := g.wait(context.Background()); err != nil || len(said) != 0 {
		t.Fatalf("err %v said %v", err, said)
	}
}

func TestHealthClientSkipsVerifyOnlyForTheHavenRoute(t *testing.T) {
	if healthClient("https://app.x.langwatch.localhost/api/health").Transport == nil {
		t.Error("the haven route must skip TLS verification")
	}
	if healthClient("https://example.com/api/health").Transport != nil {
		t.Error("any other host keeps the default verification")
	}
}

func TestRunOnceReadsTheToolsResultsAndItsStop(t *testing.T) {
	s := &suite{out: t.TempDir(), root: t.TempDir(), policy: "none", stderr: io.Discard}
	if err := s.setup(nil, []string{
		`a=echo 'FAIL x-1 (GET /api/foo, 500)'; echo 'scenarios: 5 run: 4 PASS, 1 FAIL'; exit 1`,
		`b=echo 'fuzz: stopping: sign-in refused'; exit 3`,
	}); err != nil {
		t.Fatal(err)
	}
	s.env = os.Environ()
	dir := t.TempDir()
	up := func() bool { return true }
	got := s.runOnce(context.Background(), iterationOf(s.tools[0], dir), up)
	if got.Exit != 1 || got.Pass != 4 || got.Fail != 1 || got.Stopped != "" || !slices.Equal(got.Failing, []string{"FAIL x-1"}) {
		t.Fatalf("a: %+v", got)
	}
	if _, err := os.Stat(filepath.Join(dir, "a.log")); err != nil {
		t.Errorf("the log belongs in the iteration directory: %v", err)
	}
	if got := s.runOnce(context.Background(), iterationOf(s.tools[1], t.TempDir()), up); got.Exit != 3 || got.Stopped != "sign-in refused" {
		t.Fatalf("b: %+v", got)
	}
	if got := s.runOnce(context.Background(), iterationOf(s.tools[0], t.TempDir()), func() bool { return false }); got.Stopped != "stack unhealthy" {
		t.Fatalf("a with the stack gone: %+v", got)
	}
}

func TestFirstIterationComparesWithTheNewestApidiffRun(t *testing.T) {
	runs := t.TempDir()
	dir := filepath.Join(runs, "r1", "out", "apidiff")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatal(err)
	}
	body := `{"id":"a","verdict":"FAIL"}` + "\n" + `{"id":"b","verdict":"PASS"}` + "\n"
	if err := os.WriteFile(filepath.Join(dir, "scenarios.jsonl"), []byte(body), 0o644); err != nil {
		t.Fatal(err)
	}
	s := &session{out: filepath.Join(runs, "live")}
	base := s.baseline(filepath.Join(s.out, "api"), "api")
	if base == nil || base.BaselineFrom != "r1" || !slices.Equal(base.Failing, []string{"FAIL a"}) || base.Pass != 1 {
		t.Fatalf("baseline %+v", base)
	}
	added, fixed := delta(base.Failing, []string{"FAIL c"})
	if !slices.Equal(added, []string{"FAIL c"}) || !slices.Equal(fixed, []string{"FAIL a"}) {
		t.Fatalf("delta %v %v", added, fixed)
	}
}
