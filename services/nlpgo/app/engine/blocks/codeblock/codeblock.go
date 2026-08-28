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
	// EnvAllowlist names the environment variables propagated into the
	// user-code subprocess. Anything not named here is withheld — the
	// runner never inherits the pod environment, so AWS credentials, the
	// projected service-account token path, LANGWATCH_* internals, and
	// DB/Redis/ClickHouse secrets stay out of reach of user code.
	//
	// The allowlist names what is COPIED from the engine's environment, so a
	// value the engine does not hold cannot arrive through it. That is why
	// the sandbox credential is appended after this list rather than added to
	// it: it belongs to one run, not to the process.
	//
	// Semantics:
	//   - nil            → defaultEnvAllowlist (secure default)
	//   - non-nil empty  → pass nothing (maximally locked down)
	//   - populated      → pass exactly those names, when present
	//
	// A project's own secrets reach user code via Request.Secrets (piped
	// over stdin into the `secrets` namespace), never via the environment,
	// so withholding the environment does not break the secrets contract.
	//
	// The one credential that does travel in the environment is the run's
	// sandbox key; see Request.SandboxAPIKey.
	EnvAllowlist []string
	// SandboxEndpoint is the LangWatch instance the sandbox calls, and comes
	// from the engine's own LANGWATCH_ENDPOINT. It is injected together with
	// Request.SandboxAPIKey and never on its own: a key with no endpoint, or
	// an endpoint with no key, gives agent code half a credential and one
	// failure it cannot read.
	SandboxEndpoint string
}

// defaultEnvAllowlist is the environment passed into the code-block
// subprocess when Options.EnvAllowlist is nil. It carries only what the
// Python runner legitimately needs — interpreter/locale/TLS-trust plumbing —
// and deliberately excludes every credential-bearing variable in the pod.
// Being an allowlist, any secret env var added to the deployment in future
// is withheld automatically without a code change here.
var defaultEnvAllowlist = []string{
	"PATH",
	"HOME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
	"TMPDIR",
	"PYTHONPATH",
	"PYTHONHOME",
	"PYTHONHASHSEED",
	"PYTHONIOENCODING",
	"PYTHONUNBUFFERED",
	"PYTHONDONTWRITEBYTECODE",
	"SSL_CERT_FILE",
	"SSL_CERT_DIR",
	"REQUESTS_CA_BUNDLE",
	"CURL_CA_BUNDLE",
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
		opts.DefaultTimeout = 600 * time.Second
	}
	// Secure default: a nil allowlist means "the caller didn't opt out of
	// the safe default", NOT "inherit everything". A non-nil empty slice is
	// respected as an explicit "pass nothing".
	if opts.EnvAllowlist == nil {
		opts.EnvAllowlist = defaultEnvAllowlist
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
	// Secrets are the project's decrypted secrets (from the workflow
	// DSL's `secrets` map). When non-empty the runner exposes them to
	// user code as a `secrets` namespace so `secrets.NAME` works —
	// parity with the Python executor's build_secrets_preamble.
	Secrets map[string]string
	// Params are the run's user-defined parameters (from the workflow
	// DSL's `params` map). When non-empty the runner exposes them to user
	// code as a `params` namespace so `params.NAME` works, the same shape
	// as secrets. Values are typed: a number configured as a number
	// arrives in Python as an int/float, not as a string.
	Params map[string]any
	// SandboxAPIKey is the run's own LangWatch credential. It is minted per
	// run, reaches the project's agent cache and nothing else, and expires by
	// itself, so agent code can keep state between rows without the project
	// key ever entering the sandbox. Empty means the run injects nothing.
	//
	// This is the one deliberate exception to "credentials never travel in
	// the environment": the LangWatch SDK reads LANGWATCH_API_KEY and
	// LANGWATCH_ENDPOINT from there, so putting it anywhere else would mean
	// every agent wiring it up by hand. The engine scrubs the value out of
	// captured stdout and stderr, so printing the environment stores nothing.
	SandboxAPIKey string
	// Timeout asks for LESS time than the operator allows; it can never buy
	// more. Options.DefaultTimeout carries the deployment's ceiling on how
	// long untrusted customer code may hold a worker, so Execute clamps this
	// value to it. Zero or negative means "no request of my own".
	Timeout time.Duration
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

// TimeoutType and RunnerErrorType are the only two Error.Type values this
// package produces itself; every other value is whatever Python exception class
// the customer's own code raised.
//
// They are exported because the engine switches on them to pick the NodeError
// code the client is shown, and that switch has no `default` that could tell a
// renamed discriminant apart from a customer exception — a bare literal here
// and a bare literal there meant renaming one side reclassified the timeout as
// a generic code-runner error with nothing failing to compile.
const (
	// TimeoutType marks a run the executor stopped for exceeding its limit.
	TimeoutType = "Timeout"
	// RunnerErrorType marks the runner itself failing, as opposed to the
	// customer's code raising.
	RunnerErrorType = "RunnerError"
)

func (e *Error) String() string { return fmt.Sprintf("%s: %s", e.Type, e.Message) }

// DefaultTimeout reports the wall-clock timeout the executor applies to a
// request that does not carry its own Request.Timeout. Exported so the
// wiring that builds the executor from operator config can be asserted on.
func (e *Executor) DefaultTimeout() time.Duration {
	return e.opts.DefaultTimeout
}

// childEnv builds the environment handed to the user-code subprocess from
// the configured allowlist. It always returns a non-nil slice — even when
// no allowlisted variable is present — so the caller can assign it to
// cmd.Env without risk of exec inheriting the full parent environment
// (which is what a nil cmd.Env would do).
func (e *Executor) childEnv() []string {
	allow := e.opts.EnvAllowlist
	if allow == nil {
		allow = defaultEnvAllowlist
	}
	env := make([]string, 0, len(allow))
	for _, name := range allow {
		if v, ok := os.LookupEnv(name); ok {
			env = append(env, name+"="+v)
		}
	}
	return env
}

// withSandboxCredential appends the run's LangWatch credential to env, or
// returns env unchanged.
//
// Both halves or neither: a key with no endpoint sends the call to the wrong
// instance, and an endpoint with no key gets a 401 the agent cannot act on.
// LANGWATCH_SKIP_OTEL_SETUP rides along because the run already reports this
// row, so a second exporter inside it would only spend the runner's time
// budget.
func withSandboxCredential(env []string, apiKey, endpoint string) []string {
	if apiKey == "" || endpoint == "" {
		return env
	}
	return append(env,
		"LANGWATCH_API_KEY="+apiKey,
		"LANGWATCH_ENDPOINT="+endpoint,
		"LANGWATCH_SKIP_OTEL_SETUP=true",
	)
}

// Execute runs the request. Wall-clock timeout kills the subprocess.
func (e *Executor) Execute(ctx context.Context, req Request) (*Result, error) {
	// The operator's ceiling wins. A per-request value only ever shortens the
	// budget: a workflow author must not be able to escape
	// NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS by writing a bigger number into
	// their own node. A non-positive request means no request at all — and in
	// particular keeps a negative duration away from context.WithTimeout,
	// which would expire the run before the subprocess starts.
	timeout := e.opts.DefaultTimeout
	if req.Timeout > 0 && req.Timeout < timeout {
		timeout = req.Timeout
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
		"secrets": req.Secrets,
		"params":  req.Params,
	})
	if err != nil {
		return nil, fmt.Errorf("codeblock: marshal request: %w", err)
	}

	cmd := exec.CommandContext(runCtx, e.opts.Python, e.runnerPath, resultPath) //nolint:gosec // runnerPath is operator-controlled
	// Withhold the pod environment from user code. cmd.Env is always set to
	// a non-nil slice so exec never falls back to inheriting os.Environ();
	// see childEnv. Project secrets travel via the request payload, not here.
	// The run's own sandbox credential is the one exception, and it is added
	// only when the run carries both halves of it.
	cmd.Env = withSandboxCredential(
		e.childEnv(),
		req.SandboxAPIKey,
		e.opts.SandboxEndpoint,
	)
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
				res.Error = &Error{Type: TimeoutType, Message: "code_block_timeout"}
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
			Error:      &Error{Type: TimeoutType, Message: "code_block_timeout"},
		}, nil
	}
	if runErr != nil {
		return &Result{
			DurationMS: elapsed.Milliseconds(),
			Stderr:     stderrBuf.String(),
			Error: &Error{
				Type:    RunnerErrorType,
				Message: runErr.Error(),
			},
		}, nil
	}
	return &Result{
		DurationMS: elapsed.Milliseconds(),
		Stderr:     stderrBuf.String(),
		Error:      &Error{Type: RunnerErrorType, Message: "empty_result"},
	}, nil
}

func killGroup(pid int) error {
	pgid, err := syscall.Getpgid(pid)
	if err != nil {
		return err
	}
	return syscall.Kill(-pgid, syscall.SIGKILL)
}
