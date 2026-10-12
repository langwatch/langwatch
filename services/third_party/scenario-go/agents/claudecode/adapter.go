// Package claudecode runs the Claude Code CLI (`claude -p --output-format
// stream-json --verbose`) as the agent under test of a scenario.
//
// Each turn flattens the conversation into one prompt, runs the CLI in a
// working directory, decodes its stream-json stdout as it arrives, and
// returns the turn as the assistant-visible text (the default) or as
// messages carrying the tool calls and tool results (OutputMessages).
//
// Session continuation: `claude -p` is one-shot, but the CLI keeps
// server-side session state keyed by a session id. The adapter keeps one
// session per thread. A thread's first turn sends the full history and
// captures the session id the CLI reports; later turns pass --resume <id>
// and send only the new messages, since the resumed session already holds
// the rest. When a resumed session has vanished server-side the id is
// evicted and the turn fails with a *LostSessionError, or, with
// Config.ReplayOnLostSession, is rebuilt in place from the full history into
// a fresh session (losing server-side state such as the context cache).
//
// Process lifecycle: the CLI leads its own process group, a detached
// watchdog kills that group if the harness dies first, and a timeout or a
// cancelled context terminates the whole group (SIGTERM, then SIGKILL).
package claudecode

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"runtime"
	"sync"
	"time"

	scenario "github.com/langwatch/scenario/go"
)

// DefaultTimeout bounds one turn when Config.Timeout is zero.
const DefaultTimeout = 120 * time.Second

// killGrace is how long a terminated CLI gets before it is killed, and how
// long an exited CLI's descendants may hold its output open.
const killGrace = 2 * time.Second

// Output selects what a turn returns.
type Output string

// Outputs.
const (
	// OutputText returns the assistant-visible text, tool calls and results
	// rendered inline as readable lines.
	OutputText Output = "text"
	// OutputMessages returns messages: an assistant message per turn with
	// its tool calls, and a tool message per tool result, so the judge and
	// LangWatch read the calls structurally.
	OutputMessages Output = "messages"
)

// Config configures the adapter.
type Config struct {
	// WorkingDirectory is the directory the CLI runs in. Required.
	WorkingDirectory string
	// Model, when set, is passed as --model.
	Model string
	// Timeout bounds one turn; DefaultTimeout when zero. On expiry the CLI's
	// process group is terminated and the turn fails with ErrTimeout.
	Timeout time.Duration
	// SkipPermissions passes --dangerously-skip-permissions. Off by default.
	SkipPermissions bool
	// ReplayOnLostSession rebuilds a turn whose resumed session vanished
	// server-side from the full transcript, in a fresh session, instead of
	// failing it with a *LostSessionError. The replay flattens the
	// conversation into a prompt for a NEW session and loses server-side
	// session state, so it is off by default: under an eval harness that
	// silent downgrade would change what is measured.
	ReplayOnLostSession bool
	// SkillPath, when set, is a SKILL.md that New injects into the working
	// directory (see InjectSkill).
	SkillPath string
	// Logger receives all diagnostics: the CLI's output line by line, its
	// stderr as warnings, unknown stream-json events. Nil is silent.
	Logger *slog.Logger
	// ExtraArgs are inserted before the prompt, for flags Config does not
	// model.
	ExtraArgs []string
	// ClaudeBin is the CLI binary; falls back to $CLAUDE_BIN, then "claude".
	ClaudeBin string
	// Env is set over this process's environment for the CLI. PATH set here
	// replaces the inherited one.
	Env map[string]string
	// UnsetEnv names variables removed from the CLI's environment, for
	// example a provider key the judge needs but the agent must not see.
	UnsetEnv []string
	// Output selects what a turn returns; OutputText when empty.
	Output Output
	// MaxToolResultChars caps one tool result in the conversation;
	// DefaultMaxToolResultChars when zero.
	MaxToolResultChars int
	// MaxToolInputChars caps one string inside a tool call input;
	// DefaultMaxToolInputChars when zero.
	MaxToolInputChars int
}

// ClaudeCodeAgentAdapter runs the Claude Code CLI as the agent under test.
// Its type name is the JS SDK's class name, so the agent span reads
// "ClaudeCodeAgentAdapter.call" in both SDKs. Use one adapter per scenario
// run or share it: sessions are kept per thread and Call is safe for
// concurrent use.
type ClaudeCodeAgentAdapter struct {
	cfg     Config
	timeout time.Duration
	limits  Limits
	logger  *slog.Logger

	mu       sync.Mutex
	sessions map[string]string

	// Overridden by tests.
	killGrace     time.Duration
	watchdogShell string
}

// New validates cfg and returns the adapter. When cfg.SkillPath is set, the
// skill is injected into the working directory now, so Claude Code finds it
// on the first turn.
func New(cfg Config) (*ClaudeCodeAgentAdapter, error) {
	if cfg.WorkingDirectory == "" {
		return nil, errors.New("claudecode: Config.WorkingDirectory is required")
	}
	if cfg.Timeout < 0 {
		return nil, fmt.Errorf("claudecode: Config.Timeout must be positive; got %s", cfg.Timeout)
	}
	if cfg.MaxToolResultChars < 0 || cfg.MaxToolInputChars < 0 {
		return nil, errors.New("claudecode: Config.MaxToolResultChars and MaxToolInputChars must not be negative")
	}
	switch cfg.Output {
	case "", OutputText, OutputMessages:
	default:
		return nil, fmt.Errorf("claudecode: unknown Config.Output %q", cfg.Output)
	}
	if cfg.SkillPath != "" {
		if err := InjectSkill(cfg.WorkingDirectory, cfg.SkillPath); err != nil {
			return nil, err
		}
	}
	a := &ClaudeCodeAgentAdapter{
		cfg:           cfg,
		timeout:       cfg.Timeout,
		limits:        Limits{MaxToolResultChars: cfg.MaxToolResultChars, MaxToolInputChars: cfg.MaxToolInputChars}.withDefaults(),
		logger:        cfg.Logger,
		sessions:      map[string]string{},
		killGrace:     killGrace,
		watchdogShell: defaultWatchdogShell,
	}
	if a.timeout == 0 {
		a.timeout = DefaultTimeout
	}
	if a.logger == nil {
		a.logger = discardLogger
	}
	return a, nil
}

// Role implements scenario.AgentAdapter.
func (a *ClaudeCodeAgentAdapter) Role() scenario.AgentRole { return scenario.AgentRoleAgent }

// Name implements scenario.Named.
func (a *ClaudeCodeAgentAdapter) Name() string { return "ClaudeCodeAgent" }

// Call runs one turn. A thread's first turn sends the full history and lets
// the CLI mint a session; later turns resume it with only the new messages.
//
// Only a genuinely stale session evicts the thread's session id. Any other
// failure (auth, rate limit, signal, timeout, an empty prompt that never
// reached the CLI) leaves it cached, since the server session may well
// still be valid.
func (a *ClaudeCodeAgentAdapter) Call(ctx context.Context, input scenario.AgentInput) (*scenario.AgentReturn, error) {
	threadID := input.ThreadID
	if sessionID, ok := a.session(threadID); ok {
		t, err := a.runTurn(ctx, input.NewMessages, input.Messages, sessionID, input.Stream)
		if err == nil {
			a.keepSession(threadID, t.SessionID)
			return a.output(t), nil
		}
		var cliErr *CLIError
		if !errors.As(err, &cliErr) || !cliErr.staleSession() {
			return nil, err
		}
		a.evictSession(threadID, sessionID)
		if !a.cfg.ReplayOnLostSession {
			return nil, &LostSessionError{SessionID: sessionID, ThreadID: threadID, Cause: cliErr}
		}
		a.logger.Warn("Claude Code session no longer exists; ReplayOnLostSession is set, so rebuilding "+
			"this turn from full history into a fresh session (server-side session state is lost)",
			"session", sessionID, "thread", threadID)
	}
	t, err := a.runTurn(ctx, input.Messages, input.Messages, "", input.Stream)
	if err != nil {
		return nil, err
	}
	a.keepSession(threadID, t.SessionID)
	return a.output(t), nil
}

func (a *ClaudeCodeAgentAdapter) output(t *Transcript) *scenario.AgentReturn {
	if a.cfg.Output == OutputMessages {
		return scenario.MessagesReturn(t.Messages...)
	}
	return scenario.TextReturn(t.Text)
}

func (a *ClaudeCodeAgentAdapter) session(threadID string) (string, bool) {
	a.mu.Lock()
	defer a.mu.Unlock()
	id, ok := a.sessions[threadID]
	return id, ok
}

// keepSession stores the session a successful turn reported. A failed turn
// never gets here, so an id minted by a failed run is never resumed.
func (a *ClaudeCodeAgentAdapter) keepSession(threadID, sessionID string) {
	if sessionID == "" {
		return
	}
	a.mu.Lock()
	a.sessions[threadID] = sessionID
	a.mu.Unlock()
}

// evictSession drops a dead session, unless a concurrent turn of the same
// thread already replaced it.
func (a *ClaudeCodeAgentAdapter) evictSession(threadID, sessionID string) {
	a.mu.Lock()
	if a.sessions[threadID] == sessionID {
		delete(a.sessions, threadID)
	}
	a.mu.Unlock()
}

// resolveBin is the binary to run: ClaudeBin, $CLAUDE_BIN, then "claude".
func (a *ClaudeCodeAgentAdapter) resolveBin() string {
	if a.cfg.ClaudeBin != "" {
		return a.cfg.ClaudeBin
	}
	if bin := os.Getenv("CLAUDE_BIN"); bin != "" {
		return bin
	}
	return "claude"
}

// buildArgs is the CLI argv, in a fixed order: -p --output-format
// stream-json --verbose [--model M] [--dangerously-skip-permissions]
// [--resume ID] [extra args...] <prompt>.
func (a *ClaudeCodeAgentAdapter) buildArgs(prompt, resumeSessionID string) []string {
	args := make([]string, 0, 10+len(a.cfg.ExtraArgs))
	args = append(args, "-p", "--output-format", "stream-json", "--verbose")
	if a.cfg.Model != "" {
		args = append(args, "--model", a.cfg.Model)
	}
	if a.cfg.SkipPermissions {
		args = append(args, "--dangerously-skip-permissions")
	}
	if resumeSessionID != "" {
		args = append(args, "--resume", resumeSessionID)
	}
	args = append(args, a.cfg.ExtraArgs...)
	return append(args, prompt)
}

// buildEnv is this process's environment with Env set over it, UnsetEnv
// removed, and FORCE_COLOR=0 last. PWD names the working directory, as
// os/exec only arranges by itself for a command without an explicit Env.
func (a *ClaudeCodeAgentAdapter) buildEnv() []string {
	parent := os.Environ()
	env := make([]string, 0, len(parent)+len(a.cfg.Env)+2)
	for _, kv := range parent {
		key := kv
		for i := 0; i < len(kv); i++ {
			if kv[i] == '=' && i > 0 {
				key = kv[:i]
				break
			}
		}
		if _, overridden := a.cfg.Env[key]; overridden || key == "FORCE_COLOR" || key == "PWD" || a.unset(key) {
			continue
		}
		env = append(env, kv)
	}
	for k, v := range a.cfg.Env {
		if k != "FORCE_COLOR" && !a.unset(k) {
			env = append(env, k+"="+v)
		}
	}
	if _, overridden := a.cfg.Env["PWD"]; !overridden && runtime.GOOS != "windows" {
		if dir, err := filepath.Abs(a.cfg.WorkingDirectory); err == nil {
			env = append(env, "PWD="+dir)
		}
	}
	return append(env, "FORCE_COLOR=0")
}

func (a *ClaudeCodeAgentAdapter) unset(key string) bool {
	for _, k := range a.cfg.UnsetEnv {
		if k == key {
			return true
		}
	}
	return false
}
