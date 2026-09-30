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

// Run is the command: it returns the process exit code.
func Run(args []string, stderr io.Writer) int {
	flags := flag.NewFlagSet("diffsuite", flag.ContinueOnError)
	flags.SetOutput(stderr)
	out := flags.String("out", "", "directory for logs, events.log and summary.json")
	policy := flags.String("policy", "half", "half | same-cause | any | none")
	health := flags.String("health", "", "URL that must answer 2xx before and while the tools run (default: the branch stack's /api/health)")
	chosen := flags.String("tools", strings.Join(defaultNames(), ","), "which of the default tools run; name=command after -- adds or replaces one")
	var stackChoice stackFlags
	flags.StringVar(&stackChoice.stack, "stack", "", "a running haven stack to test (default "+diffkit.CheckSlug+")")
	flags.BoolVar(&stackChoice.up, "up", false, "start the branch stack from this checkout, and destroy it at the end")
	flags.StringVar(&stackChoice.mainStack, "main-stack", "", "a running haven stack of main to compare with")
	flags.BoolVar(&stackChoice.main, "main", false, "start pinned main as a stack of its own, and destroy it at the end")
	flags.BoolVar(&stackChoice.langevals, "langevals", false, "run langevals in the branch stack -up starts (haven up +langevals)")
	flags.StringVar(&stackChoice.deployment, "deployment", saas, "saas | self-hosted: self-hosted adopts "+selfHostedSlug+" (or -up starts one with IS_SAAS=false) and runs only api by default")
	continuous := flags.Bool("continuous", false, "loop against -stack until interrupted: api and fuzzapi back to back, visual and fuzzui every -visual-every")
	visualEvery := flags.Duration("visual-every", 30*time.Minute, "with -continuous: how often visual and fuzzui start, when the load allows")
	loadMax := flags.Float64("load-max", 0, "with -continuous: visual and fuzzui wait while the 1m load average is at or above this (default: the CPU count)")
	deferred := flags.String("deferred", "", "a SaaS run's apidiff deferred.txt: api runs only the scenarios it lists")
	if flags.Parse(args) != nil {
		return 2
	}
	names, specs := splitNames(*chosen), flags.Args()
	if *continuous && (stackChoice.up || stackChoice.main) {
		fmt.Fprintln(stderr, "diffsuite: -continuous never starts a stack: adopt one with -stack")
		return 2
	}
	if stackChoice.deployment == selfHosted && !flagSet(flags, "tools") {
		names = []string{"api"}
	}
	if *deferred != "" {
		path, err := filepath.Abs(*deferred)
		if err != nil {
			fmt.Fprintln(stderr, "diffsuite:", err)
			return 2
		}
		specs = append(specs, "api+=-scenario-id '@"+path+"'")
	}
	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()
	suite := &suite{out: *out, policy: *policy, stderr: stderr, root: repoRoot(), appendLog: *continuous}
	if err := suite.setup(names, specs); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	defer suite.events.Close()
	stacks := &stacks{}
	defer stacks.stop()
	if err := stacks.resolve(ctx, stackChoice, suite.root, suite.out, stderr); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	suite.env = append(append(os.Environ(), "DIFFSUITE_OUT="+suite.out), stacks.env()...)
	suite.stacks = stacks
	fmt.Fprintf(stderr, "diffsuite: branch %s at %s; main %s\n", stacks.branch.Slug, stacks.branch.AppURL, cmp.Or(stacks.main.AppURL, "none (baselines)"))
	*health = cmp.Or(*health, stacks.branch.AppURL+"/api/health")
	if *continuous {
		return suite.continuous(ctx, continuousOptions{health: *health, visualEvery: *visualEvery, loadMax: *loadMax})
	}
	if !healthy(*health) {
		fmt.Fprintln(stderr, "diffsuite: refusing to start: not healthy:", *health)
		return 2
	}
	if err := suite.build(ctx, suite.tools); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	began := time.Now()
	suite.began = began
	for _, tool := range suite.tools {
		if err := suite.start(tool); err != nil {
			suite.signal(syscall.SIGKILL)
			fmt.Fprintln(stderr, "diffsuite:", err)
			return 2
		}
	}
	var running sync.WaitGroup
	for _, tool := range suite.tools {
		running.Add(1)
		go func() { defer running.Done(); suite.wait(tool) }()
	}
	finished := make(chan struct{})
	go suite.watch(*health, finished)
	go suite.heartbeat(finished)
	go func() {
		<-ctx.Done()
		suite.mu.Lock()
		defer suite.mu.Unlock()
		suite.stopAll("cancelled")
	}()
	running.Wait()
	close(finished)
	suite.line("all runs ended: %s", filepath.Join(suite.out, "events.log"))
	code := suite.summarize(time.Since(began))
	suite.eventsMu.Lock()
	fmt.Fprint(stdout, summaryTable(suite.tools))
	fmt.Fprint(stdout, summaryReport(suite.tools))
	suite.eventsMu.Unlock()
	return code
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
	tool.cmd = exec.Command("bash", "-c", tool.command) // #nosec G204 -- the operator's own suite.
	tool.cmd.Dir, tool.cmd.Env = suite.root, suite.env
	if tool.dir != "" {
		tool.cmd.Env = append(slices.Clone(suite.env), "DIFFSUITE_OUT="+tool.dir)
	}
	tool.cmd.Stdout, tool.cmd.Stderr = pipeOut, pipeOut
	tool.cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	tool.cmd.WaitDelay = 2 * time.Second
	tool.began = time.Now()
	if err := tool.cmd.Start(); err != nil {
		logFile.Close()
		return fmt.Errorf("%s: %w", tool.name, err)
	}
	go func() {
		defer close(tool.scanned)
		defer logFile.Close()
		scanner := bufio.NewScanner(pipeIn)
		scanner.Buffer(make([]byte, 64*1024), 4*1024*1024)
		for scanner.Scan() {
			text := scanner.Text()
			fmt.Fprintln(logFile, text)
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
		io.Copy(io.Discard, pipeIn)
	}()
	go suite.followFindings(tool)
	return nil
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
