package visualdiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "Each phase's wall time is on the run log and in summary.txt"
func TestEachPhasesWallTimeIsLoggedAndSummarised(t *testing.T) {
	stream, err := ParseRunnerStream(strings.NewReader(`{"type":"phase","side":"candidate","name":"recapture","millis":4200}` + "\n"))
	if err != nil || len(stream.Phases) != 1 || stream.Phases[0] != (RunnerPhase{Side: "candidate", Name: "recapture", Millis: 4200}) {
		t.Fatalf("phase line: %+v %v", stream.Phases, err)
	}

	options := testOptions(t)
	deps := passingDeps(&fakeRunner{}, nil, nil)
	deps.Capture = func(context.Context, RunnerPlan, CaptureOptions) (RunnerStream, error) {
		return RunnerStream{Phases: []RunnerPhase{{Side: "candidate", Name: "capture", Millis: 61000}}}, nil
	}
	var stderr bytes.Buffer
	if _, err := Execute(context.Background(), Request{Options: options, Config: testConfig(), Deps: deps}, Streams{Out: io.Discard, Err: &stderr}); err != nil {
		t.Fatal(err)
	}
	summary, err := os.ReadFile(filepath.Join(options.RunDir, SummaryFile))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{"enterprise candidate capture", "1m1s", "seed", "teardown"} {
		if !strings.Contains(string(summary), want) {
			t.Errorf("summary.txt lacks %q:\n%s", want, summary)
		}
	}
	if !strings.Contains(stderr.String(), "phase: enterprise candidate capture 1m1s") {
		t.Errorf("the run log does not time the capture:\n%s", stderr.String())
	}
}
