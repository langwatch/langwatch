// Package codeblock executes user-authored Python code in an isolated
// subprocess. The subprocess is the bundled `runner.py` helper; nlpgo
// pipes the code+inputs over stdin and reads a structured result from
// a tmp file. Timeout is enforced from Go via context cancellation.
//
// See specs/nlp-go/code-block.feature and _shared/contract.md §7.
package codeblock

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
	"time"

	_ "embed"
)

//go:embed runner.py
var runnerPySource []byte

// fakeDspyPySource is the bundled `dspy` stand-in. The runner injects
// it into sys.modules so user code that imports dspy resolves to this
// minimal stub instead of the real (heavy) dspy package — see
// fake_dspy.py header for the rationale and the surveyed surface.
//
//go:embed fake_dspy.py
var fakeDspyPySource []byte

// Options configures an Executor.
type Options struct {
	// Python is the interpreter binary. Default: "python3".
	Python string
	// RunnerPath, if set, points at an existing runner.py on disk
	// (used in dev so we don't have to write the embedded copy each
	// time). When unset, the executor materializes the embedded
	// runner.py to a temp file on first use.
	RunnerPath string
	// DefaultTimeout caps execution when the request doesn't specify one.
	DefaultTimeout time.Duration
}

// Executor runs code blocks via a Python subprocess.
type Executor struct {
	opts       Options
	runnerPath string
}

// New builds an Executor. If RunnerPath is empty the embedded runner.py
// is materialized once into a temp dir.
func New(opts Options) (*Executor, error) {
	if opts.Python == "" {
		opts.Python = "python3"
	}
	if opts.DefaultTimeout == 0 {
		opts.DefaultTimeout = 60 * time.Second
	}
	runnerPath := opts.RunnerPath
	if runnerPath == "" {
		dir, err := os.MkdirTemp("", "nlpgo-codeblock-*")
		if err != nil {
			return nil, fmt.Errorf("codeblock: tmp dir: %w", err)
		}
		runnerPath = filepath.Join(dir, "runner.py")
		if err := os.WriteFile(runnerPath, runnerPySource, 0o600); err != nil {
			return nil, fmt.Errorf("codeblock: write runner: %w", err)
		}
		// runner.py imports fake_dspy from its own directory — write
		// it alongside so the import resolves whether the executor is
		// running from the embedded copy (prod / tests) or a dev
		// RunnerPath override.
		fakeDspyPath := filepath.Join(dir, "fake_dspy.py")
		if err := os.WriteFile(fakeDspyPath, fakeDspyPySource, 0o600); err != nil {
			return nil, fmt.Errorf("codeblock: write fake_dspy: %w", err)
		}
	}
	return &Executor{opts: opts, runnerPath: runnerPath}, nil
}

// Request is what the engine hands to the executor per node invocation.
type Request struct {
	Code            string
	Inputs          map[string]any
	DeclaredOutputs []string
	Timeout         time.Duration
}

// Result is what the executor returns.
type Result struct {
	Outputs    map[string]any
	Stdout     string
	Stderr     string
	DurationMS int64
	TimedOut   bool
	Error      *Error
}

// Error captures a structured Python exception from the user code.
type Error struct {
	Type      string
	Message   string
	Traceback string
}

func (e *Error) String() string { return fmt.Sprintf("%s: %s", e.Type, e.Message) }

// Execute runs the request. Wall-clock timeout kills the subprocess.
func (e *Executor) Execute(ctx context.Context, req Request) (*Result, error) {
	timeout := req.Timeout
	if timeout == 0 {
		timeout = e.opts.DefaultTimeout
	}
	runCtx, cancel := context.WithTimeout(ctx, timeout)
	defer cancel()

	resultFile, err := os.CreateTemp("", "nlpgo-codeblock-result-*.json")
	if err != nil {
		return nil, fmt.Errorf("codeblock: tmp result: %w", err)
	}
	resultPath := resultFile.Name()
	_ = resultFile.Close()
	defer os.Remove(resultPath)

	payload, err := json.Marshal(map[string]any{
		"code":    req.Code,
		"inputs":  req.Inputs,
		"outputs": req.DeclaredOutputs,
	})
	if err != nil {
		return nil, fmt.Errorf("codeblock: marshal request: %w", err)
	}

	cmd := exec.CommandContext(runCtx, e.opts.Python, e.runnerPath, resultPath) //nolint:gosec // runnerPath is operator-controlled
	cmd.Stdin = bytes.NewReader(payload)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	var stderrBuf bytes.Buffer
	cmd.Stderr = &stderrBuf

	started := time.Now()
	runErr := cmd.Run()
	elapsed := time.Since(started)

	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	if timedOut && cmd.Process != nil {
		// Make sure the process group is gone — CommandContext kills
		// the leader but children of user code may linger.
		_ = killGroup(cmd.Process.Pid)
	}

	if data, readErr := os.ReadFile(resultPath); readErr == nil && len(data) > 0 {
		var parsed struct {
			Outputs    map[string]any `json:"outputs"`
			Stdout     string         `json:"stdout"`
			Stderr     string         `json:"stderr"`
			DurationMS int64          `json:"duration_ms"`
			Error      *Error         `json:"error"`
		}
		if err := json.Unmarshal(data, &parsed); err == nil {
			res := &Result{
				Outputs:    parsed.Outputs,
				Stdout:     parsed.Stdout,
				Stderr:     parsed.Stderr,
				DurationMS: parsed.DurationMS,
				Error:      parsed.Error,
				TimedOut:   timedOut,
			}
			if timedOut && res.Error == nil {
				res.Error = &Error{Type: "Timeout", Message: "code_block_timeout"}
			}
			return res, nil
		}
	}

	// No result file (most likely: timeout killed the process before
	// it finished writing, or invalid runner). Synthesize a result.
	if timedOut {
		return &Result{
			DurationMS: elapsed.Milliseconds(),
			TimedOut:   true,
			Stderr:     stderrBuf.String(),
			Error:      &Error{Type: "Timeout", Message: "code_block_timeout"},
		}, nil
	}
	if runErr != nil {
		return &Result{
			DurationMS: elapsed.Milliseconds(),
			Stderr:     stderrBuf.String(),
			Error: &Error{
				Type:    "RunnerError",
				Message: runErr.Error(),
			},
		}, nil
	}
	return &Result{
		DurationMS: elapsed.Milliseconds(),
		Stderr:     stderrBuf.String(),
		Error:      &Error{Type: "RunnerError", Message: "empty_result"},
	}, nil
}

func killGroup(pid int) error {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return err
	}
	return syscall.Kill(-pgid, syscall.SIGKILL)
}
