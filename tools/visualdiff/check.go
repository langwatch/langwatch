package visualdiff

import (
	"context"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"sync"
	"time"
)

// LoopCandidateURL is the fix loop's candidate stack, which `check` runs against by default.
const LoopCandidateURL = "https://app.visualdiff-loop-candidate.langwatch.localhost"

// checkCommand is `visualdiff check`: every flow (less -skip) against ONE running app,
// several at a time, no main and no screenshot comparison. It answers pass or fail per flow.
func checkCommand(ctx context.Context, args []string, streams Streams) int {
	flags := flag.NewFlagSet("check", flag.ContinueOnError)
	flags.SetOutput(streams.Err)
	root := flags.String("root", ".", "repository root")
	appURL := flags.String("url", LoopCandidateURL, "the running app to check")
	only := flags.String("only", "", "comma-separated flow ids to run (default: all)")
	skip := flags.String("skip", "", "comma-separated flow ids to leave out")
	pages := flags.Int("pages", 6, "flows run at once")
	if err := flags.Parse(args); err != nil {
		return ExitOperational
	}
	absoluteRoot, err := filepath.Abs(*root)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff:", err)
		return ExitOperational
	}
	config, err := checkConfig(absoluteRoot, *only, *skip)
	if err != nil {
		fmt.Fprintln(streams.Err, "visualdiff check:", err)
		return ExitOperational
	}
	plan := checkPlan(absoluteRoot, *appURL, *pages, config)
	fmt.Fprintf(streams.Err, "check: %d flows against %s, %d at a time\n", len(plan.Flows), *appURL, *pages)
	results := newFlowResults()
	started := time.Now()
	_, runErr := RunRunner(ctx, plan, CaptureOptions{Root: absoluteRoot, Stderr: streams.Err, OnCapture: func(capture Capture) {
		if line := results.add(capture); line != "" {
			fmt.Fprintln(streams.Err, line)
		}
	}})
	failed := results.report(streams.Out, config.Flows, time.Since(started))
	if runErr != nil {
		fmt.Fprintln(streams.Err, "visualdiff check:", runErr)
		return ExitOperational
	}
	if failed > 0 {
		return ExitFindings
	}
	return ExitClean
}

// checkConfig is visualdiff.yaml's flows narrowed by -only, less -skip.
func checkConfig(root, only, skip string) (*Config, error) {
	config, err := LoadConfig(filepath.Join(root, ConfigFile))
	if err != nil {
		return nil, err
	}
	skipped := splitList(skip)
	wanted := splitList(only)
	var ids []string
	for index := range config.Flows {
		id := config.Flows[index].ID
		if (len(wanted) == 0 || slices.Contains(wanted, id)) && !slices.Contains(skipped, id) {
			ids = append(ids, id)
		}
	}
	return config.Select([]string{}, ids)
}

// checkPlan is a runner plan with one side: the app under check, with the loop's seeded fixtures.
func checkPlan(root, appURL string, pages int, config *Config) RunnerPlan {
	identity := SeedIdentity{}.withSeededDefaults()
	fixtures := map[string]string{}
	if recorded, err := os.ReadFile(filepath.Join(LoopDir(root), "seeded")); err == nil {
		fixtures = ReadSeededMarker(recorded)["candidate"]
	}
	app := Stack{HavenURL: appURL}
	return RunnerPlan{
		Viewport:    configuredViewport(config, Viewport{Width: 1440, Height: 900}),
		Settle:      config.Settle,
		Sides:       []RunnerSide{{Name: "candidate", BaseURL: app.URL(), MailURL: app.MailURL(), Fixtures: fixtures}},
		OutDir:      filepath.Join(root, ".visualdiff", "check"),
		Slug:        identity.Slug,
		Routes:      []string{},
		Flows:       config.Flows,
		Credential:  identity,
		FrozenTime:  time.Now().UnixMilli(),
		Fixtures:    config.Fixtures,
		Concurrency: Concurrency{Routes: pages, Flows: pages},
		Edition:     EditionEnterprise,
	}
}

// flowResults keeps each flow's first failure and its held expects as captures stream in.
type flowResults struct {
	mutex    sync.Mutex
	failures map[string]string
	held     map[string]int
}

func newFlowResults() *flowResults {
	return &flowResults{failures: map[string]string{}, held: map[string]int{}}
}

// add records one capture and returns a live line for a flow's first failure.
func (results *flowResults) add(capture Capture) string {
	if capture.Kind != "flow" {
		return ""
	}
	results.mutex.Lock()
	defer results.mutex.Unlock()
	if capture.Error != "" {
		if _, seen := results.failures[capture.Key]; !seen {
			results.failures[capture.Key] = fmt.Sprintf("step %d %s: %s", capture.Index, capture.Label, head(capture.Error))
			return "FAIL " + capture.Key + " · " + results.failures[capture.Key]
		}
		return ""
	}
	if capture.Expect != "" {
		results.held[capture.Key]++
	}
	return ""
}

// report prints one line per flow and returns how many failed or proved nothing.
func (results *flowResults) report(out interface{ Write([]byte) (int, error) }, flows []Flow, took time.Duration) int {
	failed := 0
	for index := range flows {
		id := flows[index].ID
		switch failure, held := results.failures[id], results.held[id]; {
		case failure != "":
			failed++
			fmt.Fprintf(out, "FAIL     %s · %s\n", id, failure)
		case held == 0:
			failed++
			fmt.Fprintf(out, "UNPROVEN %s · no expect held\n", id)
		default:
			fmt.Fprintf(out, "PASS     %s (%d expects)\n", id, held)
		}
	}
	fmt.Fprintf(out, "%d/%d flows passed in %s\n", len(flows)-failed, len(flows), took.Round(time.Second))
	return failed
}
