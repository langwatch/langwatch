// Package diffsuite runs the diff tools in parallel, mirrors their failures
// into one events.log and stops them all when a policy says to.
package diffsuite

import (
	"bufio"
	"cmp"
	"context"
	"crypto/tls"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/langwatch/langwatch/tools/diffkit"
)

var (
	healthEvery = 30 * time.Second
	killGrace   = 20 * time.Second
)

const healthLimit = 3

var eventLine = regexp.MustCompile(`FAIL|ERROR |flows passed|scenarios: [0-9]+ run|panic|fatal`)

type stop struct {
	Reason string `json:"reason"`
	Cause  string `json:"cause"`
}

type tool struct {
	name, command string
	binary        string // the .bin/<binary> a default command runs, built before the suite starts
	optIn         bool   // a default tool that runs only when -tools names it
	dir           string // where continuous mode puts this run's log; empty means the suite's out
	cmd           *exec.Cmd
	stopLine      string
	progress      string // the latest line matching the tool's progress pattern
	lastLine      string
	tally         string // the latest tally line, the headline of the summary table
	results       toolResults
	exit          int
	done          bool
	began         time.Time
	took          time.Duration
	stop          *stop
	output        *io.PipeWriter
	scanned       chan struct{}
}

type suite struct {
	out, policy string
	root        string
	env         []string
	began       time.Time
	stacks      *stacks
	stderr      io.Writer
	events      *os.File
	eventsMu    sync.Mutex
	mu          sync.Mutex
	tools       []*tool
	stopped     string
	appendLog   bool // continuous mode keeps one events.log across restarts
}

// runOptions is the parsed command line.
type runOptions struct {
	out, policy, health, chosen, deferred string
	stackChoice                           stackFlags
	continuous                            bool
	visualEvery                           time.Duration
	loadMax                               float64
	names, specs                          []string
}

func parseRunOptions(args []string, stderr io.Writer) (runOptions, bool) {
	var options runOptions
	flags := flag.NewFlagSet("diffsuite", flag.ContinueOnError)
	flags.SetOutput(stderr)
	flags.StringVar(&options.out, "out", "", "directory for logs, events.log and summary.json")
	flags.StringVar(&options.policy, "policy", "half", "half | same-cause | any | none")
	flags.StringVar(&options.health, "health", "", "URL that must answer 2xx before and while the tools run (default: the branch stack's /api/health)")
	flags.StringVar(&options.chosen, "tools", strings.Join(defaultNames(), ","), "which of the default tools run; name=command after -- adds or replaces one")
	stackChoice := &options.stackChoice
	flags.StringVar(&stackChoice.stack, "stack", "", "a running haven stack to test (default "+diffkit.CheckSlug+")")
	flags.BoolVar(&stackChoice.up, "up", false, "start the branch stack from this checkout, and destroy it at the end")
	flags.StringVar(&stackChoice.mainStack, "main-stack", "", "a running haven stack of main to compare with")
	flags.BoolVar(&stackChoice.main, "main", false, "start pinned main as a stack of its own, and destroy it at the end")
	flags.BoolVar(&stackChoice.langevals, "langevals", false, "run langevals in the branch stack -up starts (haven up +langevals)")
	flags.StringVar(&stackChoice.deployment, "deployment", saas, "saas | self-hosted: self-hosted adopts "+selfHostedSlug+" (or -up starts one with IS_SAAS=false) and runs only api by default")
	flags.BoolVar(&options.continuous, "continuous", false, "loop against -stack until interrupted: api and fuzzapi back to back, visual and fuzzui every -visual-every")
	flags.DurationVar(&options.visualEvery, "visual-every", 30*time.Minute, "with -continuous: how often visual and fuzzui start, when the load allows")
	flags.Float64Var(&options.loadMax, "load-max", 0, "with -continuous: visual and fuzzui wait while the 1m load average is at or above this (default: the CPU count)")
	flags.StringVar(&options.deferred, "deferred", "", "a SaaS run's apidiff deferred.txt: api runs only the scenarios it lists")
	if flags.Parse(args) != nil {
		return options, false
	}
	options.names, options.specs = splitNames(options.chosen), flags.Args()
	if stackChoice.deployment == selfHosted && !flagSet(flags, "tools") {
		options.names = []string{"api"}
	}
	return options, true
}

// addDeferred narrows api to the scenarios a -deferred file lists.
func (options *runOptions) addDeferred() error {
	if options.deferred == "" {
		return nil
	}
	path, err := filepath.Abs(options.deferred)
	if err != nil {
		return err
	}
	options.specs = append(options.specs, "api+=-scenario-id '@"+path+"'")
	return nil
}

// Run is the command: it returns the process exit code.
func Run(args []string, stderr io.Writer) int {
	options, ok := parseRunOptions(args, stderr)
	if !ok {
		return 2
	}
	if options.continuous && (options.stackChoice.up || options.stackChoice.main) {
		fmt.Fprintln(stderr, "diffsuite: -continuous never starts a stack: adopt one with -stack")
		return 2
	}
	if err := options.addDeferred(); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	suite := &suite{out: options.out, policy: options.policy, stderr: stderr, root: repoRoot(), appendLog: options.continuous}
	if err := suite.setup(options.names, options.specs); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	defer suite.events.Close()
	stacks := &stacks{}
	defer stacks.stop()
	if err := stacks.resolve(ctx, stackRequest{flags: options.stackChoice, root: suite.root, out: suite.out, stderr: stderr}); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	suite.env = append(append(os.Environ(), "DIFFSUITE_OUT="+suite.out), stacks.env()...)
	suite.stacks = stacks
	fmt.Fprintf(stderr, "diffsuite: branch %s at %s; main %s\n", stacks.branch.Slug, stacks.branch.AppURL, cmp.Or(stacks.main.AppURL, "none (baselines)"))
	health := cmp.Or(options.health, stacks.branch.AppURL+"/api/health")
	if options.continuous {
		return suite.continuous(ctx, continuousOptions{health: health, visualEvery: options.visualEvery, loadMax: options.loadMax})
	}
	return suite.once(ctx, health)
}

// once runs every tool together until all end, then summarizes.
func (suite *suite) once(ctx context.Context, health string) int {
	if !healthy(health) {
		fmt.Fprintln(suite.stderr, "diffsuite: refusing to start: not healthy:", health)
		return 2
	}
	if err := suite.build(ctx, suite.tools); err != nil {
		fmt.Fprintln(suite.stderr, "diffsuite:", err)
		return 2
	}
	began := time.Now()
	suite.began = began
	if err := suite.startAll(); err != nil {
		fmt.Fprintln(suite.stderr, "diffsuite:", err)
		return 2
	}
	suite.waitAll(ctx, health)
	suite.line("all runs ended: %s", filepath.Join(suite.out, "events.log"))
	code := suite.summarize(time.Since(began))
	suite.eventsMu.Lock()
	fmt.Fprint(stdout, summaryTable(suite.tools))
	fmt.Fprint(stdout, summaryReport(suite.tools))
	suite.eventsMu.Unlock()
	return code
}

// startAll starts every tool; when one fails to start, it kills the rest.
func (suite *suite) startAll() error {
	for _, tool := range suite.tools {
		if err := suite.start(tool); err != nil {
			suite.signal(syscall.SIGKILL)
			return err
		}
	}
	return nil
}

// waitAll waits for every tool, watching health and heartbeating meanwhile;
// cancelling ctx stops them all.
func (suite *suite) waitAll(ctx context.Context, health string) {
	var running sync.WaitGroup
	for _, tool := range suite.tools {
		running.Add(1)
		go func() { defer running.Done(); suite.wait(tool) }()
	}
	finished := make(chan struct{})
	go suite.watch(health, finished)
	go suite.heartbeat(finished)
	go func() {
		<-ctx.Done()
		suite.mu.Lock()
		defer suite.mu.Unlock()
		suite.stopAll("cancelled")
	}()
	running.Wait()
	close(finished)
}

// flagSet is true when the command line named the flag, rather than leaving its default.
func flagSet(flags *flag.FlagSet, name string) bool {
	named := false
	flags.Visit(func(each *flag.Flag) { named = named || each.Name == name })
	return named
}

func (suite *suite) setup(names, specs []string) error {
	if suite.out == "" {
		return fmt.Errorf("usage: diffsuite -out <dir> [-stack <slug> | -up] [-main-stack <slug> | -main] [-deployment saas|self-hosted] [-deferred <file>] [-tools a,b] [-policy half|same-cause|any|none] [-health <url>] [-- <name>='<command>' | <name>+='<flags>' ...]")
	}
	if !strings.Contains(" half same-cause any none ", " "+suite.policy+" ") {
		return fmt.Errorf("unknown policy %q", suite.policy)
	}
	tools, err := suiteTools(names, specs)
	if err != nil {
		return err
	}
	if len(tools) == 0 {
		return fmt.Errorf("no tools to run")
	}
	suite.tools = tools
	if suite.out, err = filepath.Abs(suite.out); err != nil {
		return err
	}
	if err := os.MkdirAll(suite.out, 0o755); err != nil {
		return err
	}
	mode := os.O_CREATE | os.O_WRONLY | os.O_TRUNC
	if suite.appendLog {
		mode = os.O_CREATE | os.O_WRONLY | os.O_APPEND
	}
	events, err := os.OpenFile(filepath.Join(suite.out, "events.log"), mode, 0o644) // #nosec G304 -- the operator's own -out.
	suite.events = events
	return err
}

func (suite *suite) line(format string, args ...any) {
	suite.eventsMu.Lock()
	defer suite.eventsMu.Unlock()
	fmt.Fprintf(suite.events, format+"\n", args...)
	fmt.Fprintf(stdout, format+"\n", args...)
}

func (suite *suite) start(tool *tool) error {
	logDir := cmp.Or(tool.dir, suite.out)
	logFile, err := os.Create(filepath.Join(logDir, tool.name+".log"))
	if err != nil {
		return err
	}
	pipeIn, pipeOut := io.Pipe()
	tool.output, tool.scanned = pipeOut, make(chan struct{})
	tool.cmd = suite.command(tool, pipeOut)
	tool.began = time.Now()
	if err := tool.cmd.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("%s: %w", tool.name, err)
	}
	go suite.scan(tool, pipeIn, logFile)
	go suite.followFindings(tool)
	return nil
}

// command is the tool's shell command, run from the root in its own process
// group with both streams on output.
func (suite *suite) command(tool *tool, output *io.PipeWriter) *exec.Cmd {
	cmd := exec.Command("bash", "-c", tool.command) // #nosec G204 -- the operator's own suite.
	cmd.Dir, cmd.Env = suite.root, suite.env
	if tool.dir != "" {
		cmd.Env = append(slices.Clone(suite.env), "DIFFSUITE_OUT="+tool.dir)
	}
	cmd.Stdout, cmd.Stderr = output, output
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.WaitDelay = 2 * time.Second
	return cmd
}

// scan copies the tool's output to its log line by line, noting each line,
// until the output closes.
func (suite *suite) scan(tool *tool, pipeIn *io.PipeReader, logFile *os.File) {
	defer close(tool.scanned)
	defer logFile.Close()
	scanner := bufio.NewScanner(pipeIn)
	scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
	for scanner.Scan() {
		text := scanner.Text()
		fmt.Fprintln(logFile, text)
		suite.noteLine(tool, text)
	}
	io.Copy(io.Discard, pipeIn)
}

// noteLine passes one output line to the events log, the tool's state and
// the operator's stream.
func (suite *suite) noteLine(tool *tool, text string) {
	if eventLine.MatchString(text) {
		suite.line("[%s] %s", tool.name, text)
	}
	suite.mu.Lock()
	tool.noteLine(text)
	streamed := tool.result(text)
	suite.mu.Unlock()
	if streamed != "" && !eventLine.MatchString(text) {
		suite.say(tool.name, streamed)
	}
	if reason, ok := stopReason(text); ok {
		suite.mu.Lock()
		tool.stopLine = text
		suite.mu.Unlock()
		suite.say(tool.name, "STOPPED ("+classify(reason)+"): "+reason)
	}
}

// wait ends one tool: its EXIT line, its stop reason, then the policy.
func (suite *suite) wait(tool *tool) {
	tool.cmd.Wait()
	tool.output.Close()
	<-tool.scanned
	code := exitCode(tool.cmd.ProcessState)
	suite.line("[%s] EXIT %d", tool.name, code)
	suite.mu.Lock()
	defer suite.mu.Unlock()
	tool.exit, tool.done, tool.took = code, true, time.Since(tool.began)
	if code == diffkit.ExitStopped {
		reason, _ := stopReason(tool.stopLine)
		tool.stop = &stop{Reason: reason, Cause: classify(reason)}
	}
	if reason := suite.verdict(); reason != "" {
		suite.stopAll(reason)
	}
}

func exitCode(state *os.ProcessState) int {
	if state == nil {
		return 1
	}
	if status, ok := state.Sys().(syscall.WaitStatus); ok && status.Signaled() {
		return 128 + int(status.Signal())
	}
	return state.ExitCode()
}

// stopAll asks every running tool's process group to stop, then kills what is
// left after killGrace. The caller holds suite.mu.
func (suite *suite) stopAll(reason string) {
	if suite.stopped != "" || suite.running() == 0 {
		return
	}
	suite.stopped = reason
	message := "diffsuite: stopping all: " + reason
	suite.line("%s", message)
	fmt.Fprintln(suite.stderr, message)
	suite.signal(syscall.SIGTERM)
	time.AfterFunc(killGrace, func() {
		suite.mu.Lock()
		defer suite.mu.Unlock()
		suite.signal(syscall.SIGKILL)
	})
}

func (suite *suite) running() (count int) {
	for _, tool := range suite.tools {
		if !tool.done {
			count++
		}
	}
	return count
}

func (suite *suite) signal(signal syscall.Signal) {
	for _, tool := range suite.tools {
		if !tool.done && tool.cmd != nil && tool.cmd.Process != nil {
			syscall.Kill(-tool.cmd.Process.Pid, signal)
		}
	}
}

// healthClient skips TLS verification for the haven route (*.langwatch.localhost) only.
func healthClient(address string) *http.Client {
	client := &http.Client{Timeout: 10 * time.Second}
	if parsed, err := url.Parse(address); err == nil && strings.HasSuffix(parsed.Hostname(), ".langwatch.localhost") {
		client.Transport = &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}} // #nosec G402 -- the local haven certificate.
	}
	return client
}

func healthy(address string) bool {
	response, err := healthClient(address).Get(address)
	if err != nil {
		return false
	}
	response.Body.Close()
	return response.StatusCode/100 == 2
}

// watch polls the health URL until finished closes; three failures in a row
// stop every tool.
func (suite *suite) watch(address string, finished <-chan struct{}) {
	ticker := time.NewTicker(healthEvery)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-finished:
			return
		case <-ticker.C:
		}
		if healthy(address) {
			failures = 0
		} else if failures++; failures >= healthLimit {
			suite.mu.Lock()
			suite.stopAll("stack unhealthy")
			suite.mu.Unlock()
			return
		}
	}
}

type toolSummary struct {
	Name       string  `json:"name"`
	Exit       int     `json:"exit"`
	Stop       *stop   `json:"stop,omitempty"`
	DurationMs float64 `json:"durationMs"`
}

// summarize writes summary.json and answers the suite's exit code: 0 all
// passed, 3 stopped by policy or health, else the highest tool exit code.
func (suite *suite) summarize(took time.Duration) int {
	code, tools := 0, []toolSummary{}
	for _, tool := range suite.tools {
		code = max(code, tool.exit)
		tools = append(tools, toolSummary{tool.name, tool.exit, tool.stop, float64(tool.took.Milliseconds())})
	}
	verdict := "passed"
	if suite.stopped != "" {
		verdict, code = "stopped", diffkit.ExitStopped
	} else if code != 0 {
		verdict = "failed"
	}
	body, _ := json.MarshalIndent(map[string]any{
		"verdict": verdict, "stopReason": suite.stopped, "exit": code,
		"durationMs": took.Milliseconds(), "tools": tools,
		"startedAt": suite.began.Format(time.RFC3339), "commit": headCommit(suite.root),
		"branchStack": suite.stacks.branch.Slug, "mainStack": suite.stacks.main.Slug,
	}, "", "  ")
	os.WriteFile(filepath.Join(suite.out, "summary.json"), body, 0o644)
	return code
}
