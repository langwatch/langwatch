// Package workerrun proves the worker keeps up under load: it fires commands
// through the public API, reads every one back, watches the queues drain and
// the stack's log for error signatures. See README.md.
package workerrun

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
	"github.com/langwatch/langwatch/tools/havenrun"
)

// Options is one run's configuration, parsed from the CLI.
type Options struct {
	Stack       string
	URL         string
	RunDir      string
	Root        string
	Families    string
	N           int
	Concurrency int
	Seed        int64
	SteadyRate  float64
	Deadline    time.Duration
	Drain       time.Duration
	Log         string
	LogScope    string
}

// Env is where a run writes and the repository root it works under.
type Env struct {
	Out, ErrOut io.Writer
	Root        string
}

// Main parses args and runs once, answering a process exit code: 0 all proven,
// 1 a failure, 2 bad usage, 3 stopped before it started (diffkit.ExitStopped).
func Main(ctx context.Context, args []string, env Env) int {
	out, errOut := env.Out, env.ErrOut
	options := Options{Root: env.Root}
	flags := flag.NewFlagSet("workerrun", flag.ContinueOnError)
	flags.SetOutput(errOut)
	flags.StringVar(&options.Stack, "stack", "", "haven stack slug (default: diffsuite's branch stack, else visualdiff-check)")
	flags.StringVar(&options.URL, "url", "", "app origin instead of a haven stack: no log scan, monitor family attempted blind")
	flags.StringVar(&options.RunDir, "run-dir", "", "where summary.json goes (default .claude/tmp/workerrun/<time>)")
	flags.StringVar(&options.Families, "families", strings.Join(familyNames, ","), "families to load")
	flags.IntVar(&options.N, "n", 100, "items per family")
	flags.IntVar(&options.Concurrency, "concurrency", 16, "requests in flight, firing and reading back")
	flags.Int64Var(&options.Seed, "seed", 1, "seed for the fire order and each item's variant")
	flags.Float64Var(&options.SteadyRate, "steady-rate", 20, "items per second after the burst half (0: burst everything)")
	flags.DurationVar(&options.Deadline, "deadline", 5*time.Minute, "how long an item may take to read back after it was fired")
	flags.DurationVar(&options.Drain, "drain", 5*time.Minute, "how long the queues may take to drain after read-back")
	flags.StringVar(&options.Log, "log", "", "the stack's api log (default <worktree>/.haven/logs/<slug>/api.log)")
	flags.StringVar(&options.LogScope, "log-scope", "ours", "ours: fail on error signatures naming this run's project or org; all: on every one")
	if err := flags.Parse(args); err != nil {
		return 2
	}
	if options.N < 1 || options.Concurrency < 1 || (options.LogScope != "ours" && options.LogScope != "all") {
		fmt.Fprintln(errOut, "workerrun: -n and -concurrency must be positive, -log-scope ours or all")
		return 2
	}
	run := &run{options: options, out: out, errOut: errOut, began: time.Now(), fired502: map[string]int{}}
	run.tag = "wr" + run.began.UTC().Format("0102150405")
	if err := run.setup(ctx); err != nil {
		fmt.Fprintf(out, "workerrun: stopping: setup failed: %v\n", err)
		return diffkit.ExitStopped
	}
	return run.execute(ctx)
}

// run is one worker run's shared state; mu guards the items and the counters.
type run struct {
	options     Options
	out, errOut io.Writer
	began       time.Time
	tag         string // unique per run: every wire id starts with it
	slug        string
	appURL      string
	worktree    string
	langevals   string // "up", "down", or "" when haven could not say
	runDir      string
	client      *http.Client
	key         string
	projectID   string
	orgID       string
	families    map[string]bool
	mu          sync.Mutex
	fired502    map[string]int
	fireEnded   time.Time
	setupFailed map[string]string
	skipped     map[string]string
	teardown    []string // DELETE paths, run after the drain
	monitor     monitorRefs
	autoSlug    string
}

type monitorRefs struct{ id, evaluatorID, name string }

func (run *run) setup(ctx context.Context) error {
	if err := run.selectFamilies(); err != nil {
		return err
	}
	if err := run.resolveStack(ctx); err != nil {
		return err
	}
	if err := run.prepareRunDir(); err != nil {
		return err
	}
	if err := run.seedProject(ctx); err != nil {
		return err
	}
	run.client = &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{
		MaxIdleConns: run.options.Concurrency * 2, MaxIdleConnsPerHost: run.options.Concurrency * 2,
		IdleConnTimeout: 90 * time.Second, TLSClientConfig: havenrun.LocalTLSConfig(),
	}}
	return nil
}

func (run *run) selectFamilies() error {
	run.families = map[string]bool{}
	for _, name := range strings.Split(run.options.Families, ",") {
		name = strings.TrimSpace(name)
		if name == "" {
			continue
		}
		if !knownFamily(name) {
			return fmt.Errorf("-families: no family %q (have %s)", name, strings.Join(familyNames, ", "))
		}
		run.families[name] = true
	}
	return nil
}

func (run *run) prepareRunDir() error {
	run.runDir = run.options.RunDir
	if run.runDir == "" {
		run.runDir = filepath.Join(run.options.Root, ".claude", "tmp", "workerrun", run.began.Format("20060102-150405"))
	}
	return os.MkdirAll(run.runDir, 0o750)
}

// seedProject signs the run in with the recorded tool organisation's first project key.
func (run *run) seedProject(ctx context.Context) error {
	org, err := diffkit.SeedToolOrg(ctx, diffkit.SeedOptions{
		BaseURL: run.appURL, Tool: "workerrun", Projects: 1,
		Dir:      filepath.Join(run.options.Root, ".claude", "tmp", "workerrun"),
		Progress: func(line string) { fmt.Fprintln(run.errOut, line) },
		Client:   &http.Client{Timeout: 60 * time.Second, Transport: &http.Transport{TLSClientConfig: havenrun.LocalTLSConfig()}},
	})
	if err != nil {
		return fmt.Errorf("seed workerrun org: %w", err)
	}
	if len(org.Projects) == 0 || org.Projects[0].Key == "" {
		return errors.New("seed workerrun org: no project key")
	}
	run.key, run.projectID, run.orgID = org.Projects[0].Key, org.Projects[0].ID, org.OrgID
	return nil
}

// resolveStack reads the stack's app route, and from haven its worktree (for the
// log) and whether langevals answers (for the monitor family).
func (run *run) resolveStack(ctx context.Context) error {
	if run.options.URL != "" {
		run.appURL = strings.TrimSuffix(run.options.URL, "/")
		return nil
	}
	var stack diffkit.SharedStack
	var err error
	if run.options.Stack != "" {
		stack, err = diffkit.ReadSharedStack(ctx, run.options.Stack)
	} else {
		stack, err = diffkit.BranchStack(ctx)
	}
	if err != nil {
		return err
	}
	run.slug, run.appURL = stack.Slug, strings.TrimSuffix(stack.AppURL, "/")
	run.worktree, run.langevals = havenFacts(ctx, stack.Slug)
	return nil
}

// havenFacts reads the two facts havenrun.StackStatus does not carry.
func havenFacts(ctx context.Context, slug string) (worktree, langevals string) {
	if !havenrun.OnPath() {
		return "", ""
	}
	out, err := exec.CommandContext(ctx, havenrun.Command, havenrun.StatusArgs()...).Output() // #nosec G204 -- fixed haven status args.
	if err != nil {
		return "", ""
	}
	return parseHavenStatus(out, slug)
}

type havenService struct {
	Name      string `json:"name"`
	Listening bool   `json:"listening"`
}

func parseHavenStatus(out []byte, slug string) (worktree, langevals string) {
	var status struct {
		Stacks []struct {
			Slug        string         `json:"slug"`
			WorktreeDir string         `json:"worktreeDir"`
			Services    []havenService `json:"services"`
		} `json:"stacks"`
	}
	if json.Unmarshal(out, &status) != nil {
		return "", ""
	}
	for _, stack := range status.Stacks {
		if stack.Slug == slug {
			return stack.WorktreeDir, langevalsState(stack.Services)
		}
	}
	return "", ""
}

func langevalsState(services []havenService) string {
	for _, service := range services {
		if service.Name == "langevals" && service.Listening {
			return "up"
		}
	}
	return "down"
}

func (run *run) logPath() string {
	if run.options.Log != "" || run.worktree == "" {
		return run.options.Log
	}
	return filepath.Join(run.worktree, ".haven", "logs", run.slug, "api.log")
}

// execute runs the phases: set up, watch, fire while reading back, drain, tear down, report.
func (run *run) execute(ctx context.Context) int {
	items := run.plan(ctx)
	fmt.Fprintf(run.out, "workerrun: stack %s project %s run %s, %d items over %s, concurrency %d\n",
		cmpOr(run.slug, run.appURL), run.projectID, run.tag, len(items), strings.Join(run.chosen(), ","), run.options.Concurrency)
	window := openLogWindow(run.logPath())
	operator := signInOperator(ctx, run.appURL)
	drain := newDrainWatch(run.pipelines(), operator)
	drain.baseline(ctx)
	watching, stopWatching := context.WithCancel(ctx)
	health := &healthWatch{}
	var watchers sync.WaitGroup
	watchers.Add(2)
	go func() { defer watchers.Done(); health.run(watching, run.appURL+"/api/health") }()
	go func() { defer watchers.Done(); drain.sampleEvery(watching, 2*time.Second) }()

	firing := make(chan struct{})
	go func() {
		defer close(firing)
		run.fireAll(ctx, items)
	}()
	run.readBack(ctx, items, firing)
	<-firing
	drain.await(ctx, run.options.Drain)
	stopWatching()
	watchers.Wait()
	cleanup, cancel := context.WithTimeout(context.WithoutCancel(ctx), time.Minute)
	defer cancel()
	for _, path := range run.teardown {
		if status, _, err := run.do(cleanup, call{family: "teardown", method: http.MethodDelete, path: path}); err != nil || status >= 300 {
			fmt.Fprintf(run.errOut, "workerrun: teardown DELETE %s: status %d %v\n", path, status, err)
		}
	}
	lines, logErr := window.read()
	return run.report(observed{items: items, drain: drain, health: health,
		signatures: scanSignatures(lines, run.markers()), logPath: window.path, logErr: logErr})
}

// markers are the strings that attribute a log line to this run.
func (run *run) markers() []string {
	markers := []string{run.tag}
	for _, id := range []string{run.projectID, run.orgID} {
		if id != "" {
			markers = append(markers, id)
		}
	}
	return markers
}

// call is one request: its family (for the 502 count), method, path and JSON body.
type call struct {
	family, method, path string
	body                 any
}

// get is do for a read.
func (run *run) get(ctx context.Context, family, path string) (int, []byte, error) {
	return run.do(ctx, call{family: family, method: http.MethodGet, path: path})
}

// do sends one request with the project key and answers the status and body.
func (run *run) do(ctx context.Context, c call) (int, []byte, error) {
	var reader io.Reader
	if c.body != nil {
		encoded, err := json.Marshal(c.body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, c.method, run.appURL+c.path, reader)
	if err != nil {
		return 0, nil, err
	}
	request.Header.Set("Authorization", "Bearer "+run.key)
	request.Header.Set("X-Auth-Token", run.key)
	if c.body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	response, err := run.client.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer func() { _ = response.Body.Close() }()
	raw, err := io.ReadAll(io.LimitReader(response.Body, 32<<20))
	if response.StatusCode == http.StatusBadGateway {
		run.mu.Lock()
		run.fired502[c.family]++
		run.mu.Unlock()
	}
	return response.StatusCode, raw, err
}

// send is do for a write: any status outside 2xx is an error naming the body.
func (run *run) send(ctx context.Context, c call) ([]byte, error) {
	status, raw, err := run.do(ctx, c)
	if err == nil && (status < 200 || status > 299) {
		err = fmt.Errorf("status %d: %s", status, oneLine(string(raw)))
	}
	return raw, err
}

func cmpOr(value, fallback string) string {
	if value == "" {
		return fallback
	}
	return value
}

func oneLine(text string) string {
	text = strings.Join(strings.Fields(text), " ")
	if len(text) > 160 {
		return text[:157] + "..."
	}
	return text
}

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
