// Package diffsuite runs the diff tools in parallel, mirrors their failures
// into one events.log and stops them all when a policy says to.
package diffsuite

import (
	"bufio"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
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
	cmd           *exec.Cmd
	stopLine      string
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
	stderr      io.Writer
	events      *os.File
	eventsMu    sync.Mutex
	mu          sync.Mutex
	tools       []*tool
	stopped     string
}

// Run is the command: it returns the process exit code.
func Run(args []string, stderr io.Writer) int {
	flags := flag.NewFlagSet("diffsuite", flag.ContinueOnError)
	flags.SetOutput(stderr)
	out := flags.String("out", "", "directory for logs, events.log and summary.json")
	policy := flags.String("policy", "half", "half | same-cause | any | none")
	health := flags.String("health", "", "URL that must answer 2xx before and while the tools run")
	if flags.Parse(args) != nil {
		return 2
	}
	suite := &suite{out: *out, policy: *policy, stderr: stderr}
	if err := suite.setup(flags.Args()); err != nil {
		fmt.Fprintln(stderr, "diffsuite:", err)
		return 2
	}
	defer suite.events.Close()
	if *health != "" && !healthy(*health) {
		fmt.Fprintln(stderr, "diffsuite: refusing to start: not healthy:", *health)
		return 2
	}
	began := time.Now()
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
	if *health != "" {
		go suite.watch(*health, finished)
	}
	running.Wait()
	close(finished)
	suite.line("all runs ended: %s", filepath.Join(suite.out, "events.log"))
	return suite.summarize(time.Since(began))
}

func (suite *suite) setup(specs []string) error {
	if suite.out == "" || len(specs) == 0 {
		return fmt.Errorf("usage: diffsuite -out <dir> [-policy half|same-cause|any|none] [-health <url>] -- <name>='<command>' ...")
	}
	if !strings.Contains(" half same-cause any none ", " "+suite.policy+" ") {
		return fmt.Errorf("unknown policy %q", suite.policy)
	}
	for _, spec := range specs {
		name, command, ok := strings.Cut(spec, "=")
		if !ok || name == "" || command == "" {
			return fmt.Errorf("%q is not name=command", spec)
		}
		suite.tools = append(suite.tools, &tool{name: name, command: command})
	}
	if err := os.MkdirAll(suite.out, 0o755); err != nil {
		return err
	}
	events, err := os.Create(filepath.Join(suite.out, "events.log"))
	suite.events = events
	return err
}

func (suite *suite) line(format string, args ...any) {
	suite.eventsMu.Lock()
	defer suite.eventsMu.Unlock()
	fmt.Fprintf(suite.events, format+"\n", args...)
}

func (suite *suite) start(tool *tool) error {
	logFile, err := os.Create(filepath.Join(suite.out, tool.name+".log"))
	if err != nil {
		return err
	}
	pipeIn, pipeOut := io.Pipe()
	tool.output, tool.scanned = pipeOut, make(chan struct{})
	tool.cmd = exec.Command("bash", "-c", tool.command)
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
			if _, ok := stopReason(text); ok {
				suite.mu.Lock()
				tool.stopLine = text
				suite.mu.Unlock()
			}
		}
		io.Copy(io.Discard, pipeIn)
	}()
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

func healthy(url string) bool {
	response, err := (&http.Client{Timeout: 10 * time.Second}).Get(url)
	if err != nil {
		return false
	}
	response.Body.Close()
	return response.StatusCode/100 == 2
}

// watch polls the health URL until finished closes; three failures in a row
// stop every tool.
func (suite *suite) watch(url string, finished <-chan struct{}) {
	ticker := time.NewTicker(healthEvery)
	defer ticker.Stop()
	failures := 0
	for {
		select {
		case <-finished:
			return
		case <-ticker.C:
		}
		if healthy(url) {
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
	}, "", "  ")
	os.WriteFile(filepath.Join(suite.out, "summary.json"), body, 0o644)
	return code
}
