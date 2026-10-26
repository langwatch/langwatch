// Package codeblock executes user-authored Python code in an isolated
// subprocess. The subprocess is the bundled `runner.py` helper, which asks
// nlpgo for the code+inputs and writes a structured result to a tmp file.
// Timeout is enforced from Go via context cancellation.
//
// On the multi-tenant cloud many customers' code blocks run in one nlpgo
// container, so an execution has to be isolated from the others and not just
// from the engine. Four properties carry that, and each is a test in this
// package:
//
//   - The runner and the `dspy` stand-in are never written to disk. They
//     travel from the engine's memory to the interpreter over argv and the
//     payload, and the runner drops the working directory from sys.path, so no
//     code the interpreter loads comes from a place user code can write.
//   - Nothing an execution starts outlives it. The interpreter leads its own
//     process group, every exit path kills the group, and a descendant that
//     detached from it is found as a child of the engine and killed too (see
//     processtree_linux.go).
//   - Each execution works in a directory of its own, with a random name
//     inside a root that cannot be listed, removed when the execution ends.
//   - One execution cannot read another's process. The interpreter is handed
//     nothing of the run, makes itself non-dumpable and then asks for its
//     payload over a socket answered by the pid the kernel reports for the
//     process connecting (see payloadchannel_linux.go).
//
// What this does not do is give an execution its own UID, PID namespace or
// cgroup. All three would be stronger: a per-execution UID would make the
// filesystem and /proc barriers kernel-enforced rather than a matter of
// unguessable names. None is reachable from the shipped container, which runs
// as a non-root user with every capability dropped, no_new_privs on, a
// read-only root filesystem and a read-only cgroupfs — so CAP_SETUID,
// CLONE_NEWPID (blocked by the default seccomp profile without CAP_SYS_ADMIN)
// and a writable cgroup subtree are all out of reach. Granting any of them
// would weaken the container more than it hardens the sandbox.
//
// See specs/nlp-go/code-block.feature and _shared/contract.md §7.
package codeblock

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"sync"
	"syscall"
	"time"

	_ "embed"

	"go.uber.org/zap"
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
	// RunnerPath, if set, points at an existing runner.py on disk, and
	// its directory is where fake_dspy.py is looked for too (used in dev
	// to run an edited runner without rebuilding the binary). The files
	// are read once, when the executor is built; from then on the
	// executor works from those bytes and never reads the path again, so
	// a dev override is as immutable to user code as the embedded copy.
	// When unset, the embedded runner.py and fake_dspy.py are used.
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
	// Logger reports what teardown could not finish. Optional: a nil logger
	// discards those reports rather than failing an execution.
	Logger *zap.Logger
}

// logger is the configured logger or a sink, so callers never branch.
func (o Options) logger() *zap.Logger {
	if o.Logger == nil {
		return zap.NewNop()
	}
	return o.Logger
}

// defaultEnvAllowlist is the environment passed into the code-block
// subprocess when Options.EnvAllowlist is nil. It carries only what the
// Python runner legitimately needs — interpreter/locale/TLS-trust plumbing —
// and deliberately excludes every credential-bearing variable in the pod.
// Being an allowlist, any secret env var added to the deployment in future
// is withheld automatically without a code change here.
//
// TMPDIR is deliberately not on it. The runner points it at the execution's
// own directory before any user code runs, so copying the deployment's value
// would only name the engine's temp root in a place every execution can read.
var defaultEnvAllowlist = []string{
	"PATH",
	"HOME",
	"LANG",
	"LC_ALL",
	"LC_CTYPE",
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
//
// The runner sources are held as bytes in the engine's own memory and reach
// the interpreter over argv and stdin, never as a file. User code and the
// interpreter run as the same user, so a file the subprocess can read is a
// file it can also rewrite; the only copy it cannot reach is the one that was
// never on the filesystem. The execution's own directory therefore holds no
// code at all, and what one execution runs cannot depend on what another
// wrote.
type Executor struct {
	opts           Options
	runnerSource   []byte
	fakeDspySource []byte
	// scratchRoot holds this process's per-execution directories. Created
	// once, because its mode is what keeps them from being enumerated.
	scratchRoot string
	// payload is how an execution's payload reaches its interpreter, nil
	// where there is no channel and the payload goes on stdin.
	payload *payloadChannel
}

// New builds an Executor, reading the runner sources it holds in memory for
// every execution: the embedded copies, or the files named by
// Options.RunnerPath when a dev run overrides them. Neither is ever written to
// disk; both travel to the interpreter over argv and stdin.
func New(opts Options) (*Executor, error) {
	if opts.Python == "" {
		opts.Python = "python3"
	}
	if opts.DefaultTimeout == 0 {
		// Counterpart: NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_DEFAULT_SECONDS in
		// platform/app/src/server/nlpgo/timeouts.ts, which the platform's client
		// falls back to when the operator names no ceiling. Change both together.
		opts.DefaultTimeout = 600 * time.Second
	}
	// Secure default: a nil allowlist means "the caller didn't opt out of
	// the safe default", NOT "inherit everything". A non-nil empty slice is
	// respected as an explicit "pass nothing".
	if opts.EnvAllowlist == nil {
		opts.EnvAllowlist = defaultEnvAllowlist
	}
	runnerSource := runnerPySource
	fakeDspySource := fakeDspyPySource
	if opts.RunnerPath != "" {
		loaded, err := os.ReadFile(opts.RunnerPath)
		if err != nil {
			return nil, fmt.Errorf("codeblock: read runner %q: %w", opts.RunnerPath, err)
		}
		runnerSource = loaded
		// The stand-in travels in the payload the runner reads, so an
		// override of the runner is an override of the pair. A dev checkout
		// that carries only the runner keeps the embedded stand-in.
		sibling := filepath.Join(filepath.Dir(opts.RunnerPath), "fake_dspy.py")
		if loaded, err := os.ReadFile(sibling); err == nil {
			fakeDspySource = loaded
		} else if !errors.Is(err, os.ErrNotExist) {
			return nil, fmt.Errorf("codeblock: read fake_dspy %q: %w", sibling, err)
		}
	}
	// From here on this process spawns user code, so it takes on being the
	// reaper for the descendants that detach from an execution, and takes its
	// own /proc files away from the user they run as.
	enableProcessHardening()
	// A channel the runner asks for its payload on, so nothing of the run is
	// in the interpreter when it starts. Where there is one there is no
	// acceptable fallback: a payload on stdin is readable out of /proc by
	// another execution in the moment before the runner hides itself, so an
	// engine that cannot bind the socket refuses to serve code blocks.
	channel, err := newPayloadChannel()
	if err != nil {
		return nil, err
	}
	scratchRoot, err := newScratchRoot()
	if err != nil {
		return nil, err
	}
	return &Executor{
		opts:           opts,
		runnerSource:   runnerSource,
		fakeDspySource: fakeDspySource,
		scratchRoot:    scratchRoot,
		payload:        channel,
	}, nil
}

// scratchRootMode is write and execute for the owner, and nothing else. The
// engine can create and remove execution directories inside it; a process that
// does not already know an execution's directory name cannot list the root to
// learn one, and the names are random. Everything in the container runs as the
// same user, so this is a barrier against discovery, not against a process
// that sets out to remove it — that one needs the per-execution UID the
// package doc explains we cannot have here.
const scratchRootMode = 0o300

// scratchRootSweep bounds the clearing of a stale root to once per process: a
// second Executor must not remove the directories of the executions the first
// one is running.
var scratchRootSweep sync.Once

// newScratchRoot creates the root this process's execution directories live
// in, under TMPDIR (an emptyDir with a size limit in the chart, so a code
// block that writes too much fills its own volume and not the node).
//
// One root per engine process, named after its pid. A container that restarts
// comes back with the same pid on an emptyDir that survived it, so the root is
// emptied once per process before any execution runs: nothing is ever read out
// of it, but directories a crashed engine never removed would otherwise count
// against the volume's size limit for as long as the pod lives.
func newScratchRoot() (string, error) {
	root := filepath.Join(os.TempDir(), fmt.Sprintf("nlpgo-codeblock-%d", os.Getpid()))
	scratchRootSweep.Do(func() { removeRunDir(root) })
	if err := os.MkdirAll(root, 0o700); err != nil {
		return "", fmt.Errorf("codeblock: scratch root: %w", err)
	}
	if err := os.Chmod(root, scratchRootMode); err != nil {
		return "", fmt.Errorf("codeblock: scratch root mode: %w", err)
	}
	return root, nil
}

// newRunDir creates the working directory for one execution, with a random
// name inside the engine's scratch root. No code is written into it — the
// runner and the stand-in travel in memory — so the only files it ever holds
// are the result file and whatever user code writes. The caller removes it
// when the execution ends.
func (e *Executor) newRunDir() (string, error) {
	dir, err := os.MkdirTemp(e.scratchRoot, "run-")
	if err != nil {
		return "", fmt.Errorf("codeblock: run dir: %w", err)
	}
	return dir, nil
}

// removeRunDir disposes of one execution's directory.
//
// Two reasons it is not one RemoveAll of the whole path. RemoveAll opens the
// PARENT directory to unlink from it, and the parent is the scratch root,
// which has no read permission — that is what stops one execution enumerating
// another's. Emptying the directory first and then removing it by name needs
// only write and execute on the root, which the engine has.
//
// The second is user code chmodding a directory it created inside its own
// read-only: unlinking a file needs write permission on the directory holding
// it, so the removal fails and the tree stays on disk. The next execution
// still gets a fresh directory, so the isolation property holds either way,
// but a long-lived engine process would accumulate them until the volume
// filled. Restoring owner write permission on the way down costs one walk and
// removes the only failure mode user code can arrange for itself.
func removeRunDir(dir string) {
	if err := emptyAndRemove(dir); err == nil {
		return
	}
	_ = filepath.WalkDir(dir, func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			// Keep walking: one unreadable entry must not abandon the rest.
			return nil //nolint:nilerr // best-effort cleanup, see the doc comment
		}
		if entry.IsDir() {
			// G302 does not distinguish a directory from a file: 0700 is already
			// owner-only, and the execute bit is what makes a directory
			// traversable at all.
			_ = os.Chmod(path, 0o700) //nolint:gosec // directory mode, not a file mode
		}
		return nil
	})
	_ = emptyAndRemove(dir)
}

// emptyAndRemove removes everything inside dir, then dir itself.
func emptyAndRemove(dir string) error {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(dir, entry.Name())); err != nil {
			return err
		}
	}
	return os.Remove(dir)
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

// sandboxCredential names the LangWatch variables user code reads, or nothing.
//
// Both halves or neither: a key with no endpoint sends the call to the wrong
// instance, and an endpoint with no key gets a 401 the agent cannot act on.
// LANGWATCH_SKIP_OTEL_SETUP rides along because the run already reports this
// row, so a second exporter inside it would only spend the runner's time
// budget.
//
// These travel in the payload and are put into the environment by the runner,
// not handed to exec. A variable exec is given is in the process's initial
// environment, which another process running as the same user can read out of
// /proc for as long as the run lasts; one the runner sets afterwards is not
// there at all. User code reads it from os.environ either way.
func sandboxCredential(apiKey, endpoint string) map[string]string {
	if apiKey == "" || endpoint == "" {
		return map[string]string{}
	}
	return map[string]string{
		"LANGWATCH_API_KEY":         apiKey,
		"LANGWATCH_ENDPOINT":        endpoint,
		"LANGWATCH_SKIP_OTEL_SETUP": "true",
	}
}

// runnerEnv is what the runner puts into its own environment before any user
// code runs: the run's credential, its scratch directory, and the token
// teardown recognizes the run's processes by.
//
// TMPDIR is set here rather than handed to exec so the deployment's own TMPDIR
// cannot send the subprocess's scratch files to a location shared with other
// executions, and so the directory's name is not sitting in a place another
// execution can read. Python reads it when something first asks for a
// temporary file, which is always after this.
func runnerEnv(credential map[string]string, runDir, token string) map[string]string {
	env := map[string]string{
		"TMPDIR":       runDir,
		runTokenEnvVar: token,
	}
	for name, value := range credential {
		env[name] = value
	}
	return env
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

	// One directory per execution, holding the result file and whatever user
	// code writes, removed on the way out. It carries no code, so there is
	// nothing in it a later execution could be made to load.
	runDir, err := e.newRunDir()
	if err != nil {
		return nil, err
	}
	defer removeRunDir(runDir)

	resultPath := filepath.Join(runDir, "result.json")
	token, err := newRunToken()
	if err != nil {
		return nil, err
	}
	// The result file is in a directory another execution should not know
	// about, so the nonce is what makes reading it safe anyway: a process that
	// did learn the path can write the file, but not a file this execution
	// will accept.
	nonce, err := newRunToken()
	if err != nil {
		return nil, err
	}

	// Everything the run needs that is worth hiding goes here rather than into
	// the environment or the command line, both of which another process
	// running as the same user can read out of /proc: the project's secrets
	// (as before), the run's credential, the run token, the scratch directory
	// and the path of the result file.
	payload, err := json.Marshal(map[string]any{
		"code":        req.Code,
		"inputs":      req.Inputs,
		"outputs":     req.DeclaredOutputs,
		"secrets":     req.Secrets,
		"params":      req.Params,
		"dspy_stub":   string(e.fakeDspySource),
		"result_path": resultPath,
		"work_dir":    runDir,
		"nonce":       nonce,
		"env":         runnerEnv(sandboxCredential(req.SandboxAPIKey, e.opts.SandboxEndpoint), runDir, token),
	})
	if err != nil {
		return nil, fmt.Errorf("codeblock: marshal request: %w", err)
	}

	// The runner is passed as source on the command line rather than as a
	// path: a file next to the user's working directory is a file the user's
	// code can rewrite. `-s` keeps the per-user site directory out of
	// sys.path; the working directory is dropped by the runner itself, which
	// runs before any user code. PYTHONPATH is left alone because it is how
	// both runtime images reach the curated sandbox libraries.
	// The command line carries no path belonging to the run: it is readable
	// from /proc by any process running as the same user, non-dumpable or not,
	// so a path here is a path every other execution learns.
	cmd := exec.CommandContext(runCtx, e.opts.Python, "-s", "-c", string(e.runnerSource)) //nolint:gosec // the source is the engine's own embedded runner, not user input
	// Withhold the pod environment from user code. cmd.Env is always set to
	// a non-nil slice so exec never falls back to inheriting os.Environ();
	// see childEnv. What the run itself carries — secrets, its credential, its
	// token, its directory — travels in the payload and is put into the
	// environment by the runner, where another execution cannot read it.
	cmd.Env = append(e.childEnv(), e.payload.channelEnv()...)
	// Started outside the run's directory, and the runner moves into it from
	// the payload before any user code runs. A working directory is readable
	// from /proc in the moment before the runner is hidden, so starting in the
	// run's own directory would hand its name to anything watching.
	cmd.Dir = "/"
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}

	// Without a payload channel (a developer's macOS checkout) the payload
	// goes on stdin as it used to. With one, the interpreter is handed no
	// stdin at all and asks for its payload once it is hidden.
	var stdin io.WriteCloser
	if e.payload == nil {
		if stdin, err = cmd.StdinPipe(); err != nil {
			return nil, fmt.Errorf("codeblock: stdin pipe: %w", err)
		}
	}

	// stderr goes to a file rather than to a buffer, so exec hands the child a
	// descriptor instead of a pipe it copies in a goroutine. A process that
	// detaches from the execution inherits that descriptor and would otherwise
	// hold the pipe open, and with it Wait, for as long as it kept running —
	// past the timeout the whole executor exists to enforce.
	stderrFile, err := newRunnerStderr(e.scratchRoot)
	if err != nil {
		return nil, err
	}
	defer func() { _ = stderrFile.Close() }()
	cmd.Stderr = stderrFile
	// Backstop for the same class of hang on the stdin pipe, which exec still
	// copies in a goroutine: a child that never reads its input while
	// something it started holds the read end open.
	cmd.WaitDelay = 2 * time.Second

	started := time.Now()
	runErr := runningChildren.start(cmd, payload)
	if runErr == nil {
		pid := cmd.Process.Pid
		if stdin != nil {
			_, _ = stdin.Write(payload)
			_ = stdin.Close()
		}
		runErr = cmd.Wait()
		runningChildren.release(pid)
		// Every exit path, not only the timeout: an execution that returned
		// an output or raised can have left a process running just as one
		// that ran out of time can. Setpgid makes the interpreter the leader
		// of its group, so its pid is the group id.
		terminateRunTree(runScope{
			pid:   pid,
			pgid:  pid,
			token: token,
			dir:   runDir,
		}, e.opts.logger())
	}
	elapsed := time.Since(started)

	timedOut := errors.Is(runCtx.Err(), context.DeadlineExceeded)
	stderrText := readRunnerStderr(stderrFile)

	if data, readErr := os.ReadFile(resultPath); readErr == nil && len(data) > 0 {
		var parsed struct {
			Outputs    map[string]any `json:"outputs"`
			Stdout     string         `json:"stdout"`
			Stderr     string         `json:"stderr"`
			DurationMS int64          `json:"duration_ms"`
			Error      *Error         `json:"error"`
			Nonce      string         `json:"nonce"`
		}
		// A result is this execution's own or it is nothing: the nonce came in
		// on the payload, so a file written by anything that did not read the
		// payload cannot carry it, and is not read as an output here.
		if err := json.Unmarshal(data, &parsed); err == nil && parsed.Nonce == nonce {
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
			Stderr:     stderrText,
			Error:      &Error{Type: TimeoutType, Message: "code_block_timeout"},
		}, nil
	}
	if runErr != nil {
		return &Result{
			DurationMS: elapsed.Milliseconds(),
			Stderr:     stderrText,
			Error: &Error{
				Type:    RunnerErrorType,
				Message: runErr.Error(),
			},
		}, nil
	}
	return &Result{
		DurationMS: elapsed.Milliseconds(),
		Stderr:     stderrText,
		Error:      &Error{Type: RunnerErrorType, Message: "empty_result"},
	}, nil
}

// maxRunnerStderr bounds what is read back from the subprocess's stderr. The
// runner captures the user's own stderr into the result file, so this stream
// carries interpreter-level diagnostics and a cap costs nothing — except to
// code that writes gigabytes to its descriptor, which is why there is one.
const maxRunnerStderr = 64 << 10

// newRunnerStderr opens the file the interpreter's own stderr goes to, in the
// engine's scratch root and unlinked at once.
//
// Not in the run's directory: a descriptor exec hands the interpreter can be
// cloned through /proc in the moment before the runner hides itself, and the
// name of that descriptor would then name the run's directory. Unlinked
// because a file with no name is a file another execution cannot open even
// knowing where it was.
func newRunnerStderr(scratchRoot string) (*os.File, error) {
	file, err := os.CreateTemp(scratchRoot, "stderr-")
	if err != nil {
		return nil, fmt.Errorf("codeblock: stderr file: %w", err)
	}
	if err := os.Remove(file.Name()); err != nil {
		_ = file.Close()
		return nil, fmt.Errorf("codeblock: stderr file: %w", err)
	}
	return file, nil
}

// readRunnerStderr reads what the subprocess wrote to its stderr, for the
// paths where the runner never produced a result file and that text is the
// only account of why. The file has no name, so it is read back through the
// descriptor the executor still holds.
func readRunnerStderr(file *os.File) string {
	if _, err := file.Seek(0, io.SeekStart); err != nil {
		return ""
	}
	data, err := io.ReadAll(io.LimitReader(file, maxRunnerStderr))
	if err != nil {
		return ""
	}
	return string(data)
}

// newRunToken mints the value every process in one execution carries in its
// environment, so teardown can tell a process that detached from this
// execution from one belonging to another.
func newRunToken() (string, error) {
	raw := make([]byte, 16)
	if _, err := rand.Read(raw); err != nil {
		return "", fmt.Errorf("codeblock: run token: %w", err)
	}
	return hex.EncodeToString(raw), nil
}
