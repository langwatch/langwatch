package pi

// The agent conformance tests drive a FAKE WRAPPER: this test binary re-exec'd
// as a subprocess speaking the langy-worker protocol (PROTOCOL.md) over real
// stdio pipes. Hermetic, no pi SDK, no LLM, no network. TestMain flips into
// wrapper mode when the marker env var is present; each test picks a scripted
// behavior via LANGY_PI_FAKE_MODE.

import (
	"bufio"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"sync"
	"syscall"
	"testing"
	"time"

	"github.com/langwatch/langwatch/services/langyagent/app"
)

const (
	fakeWrapperMarkerEnv = "LANGY_PI_FAKE_WRAPPER"
	fakeWrapperModeEnv   = "LANGY_PI_FAKE_MODE"
)

func TestMain(m *testing.M) {
	if os.Getenv(fakeWrapperMarkerEnv) == "1" {
		fakeWrapperMain(os.Getenv(fakeWrapperModeEnv))
		return
	}
	os.Exit(m.Run())
}

// fakeEmit writes one protocol line to stdout (the real pipe the agent reads).
var fakeEmitMu sync.Mutex

func fakeEmit(ev map[string]any) {
	body, err := json.Marshal(ev)
	if err != nil {
		return
	}
	fakeEmitMu.Lock()
	defer fakeEmitMu.Unlock()
	_, _ = os.Stdout.Write(append(body, '\n'))
}

func fakeWrapperMain(mode string) {
	if mode == "deadfast" {
		os.Exit(1)
	}
	if mode == "noready" {
		// Alive and silent is the whole point of this mode: WaitReady's timer
		// must win. Sleeping removes every self-exit path (a stdin read error
		// must not end the process early; a bare select would trip the runtime
		// deadlock detector).
		for {
			time.Sleep(time.Hour)
		}
	}
	if mode == "resumed" {
		fakeEmit(map[string]any{"type": "ready", "protocol": 1, "resumed": true})
	} else {
		fakeEmit(map[string]any{"type": "ready", "protocol": 1})
	}
	in := bufio.NewScanner(os.Stdin)
	in.Buffer(make([]byte, 0, 64*1024), 4*1024*1024)
	currentTurn := ""
	for in.Scan() {
		var cmd struct {
			Type       string `json:"type"`
			TurnID     string `json:"turnId"`
			Prompt     string `json:"prompt"`
			DeadlineMs int64  `json:"deadlineMs"`
		}
		if err := json.Unmarshal(in.Bytes(), &cmd); err != nil {
			continue
		}
		switch cmd.Type {
		case "ping":
			fakeEmit(map[string]any{"type": "pong"})
		case "turn":
			currentTurn = cmd.TurnID
			fakeEmit(map[string]any{"type": "turn_started", "turnId": cmd.TurnID})
			switch mode {
			case "error":
				fakeEmit(map[string]any{"type": "turn_done", "turnId": cmd.TurnID, "outcome": "error", "errorMessage": "model exploded"})
			case "abort", "handoff":
				// Emit one delta so the test can observe the turn running,
				// then wait for the abort / shutdown_imminent command.
				fakeEmit(map[string]any{"type": "delta", "turnId": cmd.TurnID, "text": "partial"})
			case "die":
				os.Exit(1)
			case "junk":
				_, _ = os.Stdout.WriteString("this is not json\n")
				fakeEmitMu.Lock()
				// An oversized line: over the reader's 4MB line cap.
				huge := make([]byte, 5*1024*1024)
				for i := range huge {
					huge[i] = 'x'
				}
				_, _ = os.Stdout.Write(append(huge, '\n'))
				fakeEmitMu.Unlock()
				fakeEmit(map[string]any{"type": "delta", "turnId": cmd.TurnID, "text": "ok"})
				fakeEmit(map[string]any{"type": "turn_done", "turnId": cmd.TurnID, "outcome": "ok"})
			default: // happy
				fakeEmit(map[string]any{"type": "delta", "turnId": cmd.TurnID, "text": "Hello"})
				fakeEmit(map[string]any{"type": "reasoning", "turnId": cmd.TurnID, "text": "thinking hard"})
				fakeEmit(map[string]any{
					"type": "tool_start", "turnId": cmd.TurnID,
					// Composite id like the responses lane produces: opaque.
					"id": "call_1|fc_1", "name": "bash",
					"input": map[string]any{"command": "ls"},
				})
				fakeEmit(map[string]any{
					"type": "tool_update", "turnId": cmd.TurnID,
					"id": "call_1|fc_1", "name": "bash", "output": "fi",
				})
				fakeEmit(map[string]any{
					"type": "tool_end", "turnId": cmd.TurnID,
					"id": "call_1|fc_1", "name": "bash",
					"input":   map[string]any{"command": "ls"},
					"isError": false, "output": "file.txt",
				})
				fakeEmit(map[string]any{
					"type": "plan", "turnId": cmd.TurnID,
					"items": []map[string]any{{"content": "Scanning traces — 2/4", "status": "in_progress"}},
				})
				fakeEmit(map[string]any{"type": "delta", "turnId": cmd.TurnID, "text": "world"})
				fakeEmit(map[string]any{"type": "turn_done", "turnId": cmd.TurnID, "outcome": "ok"})
			}
		case "abort":
			if mode != "abort" || currentTurn == "" {
				continue
			}
			if cmd.TurnID != currentTurn {
				// The id-mismatch is observable: a mid-turn delta marks the
				// ignored abort, and the turn keeps running.
				fakeEmit(map[string]any{"type": "delta", "turnId": currentTurn, "text": "IGNORED-ABORT"})
				continue
			}
			fakeEmit(map[string]any{"type": "turn_done", "turnId": currentTurn, "outcome": "aborted"})
			currentTurn = ""
		case "shutdown_imminent":
			if mode == "handoff" && currentTurn != "" {
				fakeEmit(map[string]any{"type": "handoff", "turnId": currentTurn, "seed": "SEED-42"})
				currentTurn = ""
			}
		}
	}
	// stdin EOF: the manager is gone.
	os.Exit(0)
}

// testRunner is a plain, unprivileged app.Runner for tests: no chown, no
// setuid, just a process group so cleanup can signal the tree.
type testRunner struct{}

func (testRunner) CommandContext(ctx context.Context, binary string, args ...string) *exec.Cmd {
	return exec.CommandContext(ctx, binary, args...)
}
func (testRunner) Chown(string, uint32) error  { return nil }
func (testRunner) Lchown(string, uint32) error { return nil }
func (testRunner) SysProcAttr(uint32) *syscall.SysProcAttr {
	return &syscall.SysProcAttr{Setpgid: true}
}
func (testRunner) Name() string { return "test" }

// AppliesIdentity mirrors sharedidentity: this fake applies no uid.
func (testRunner) AppliesIdentity() bool { return false }

// fakeWrapperCap smuggles the fake-wrapper marker + mode through the spawn's
// allowlisted env assembly the way any capability contributes env.
type fakeWrapperCap struct{ mode string }

func (c fakeWrapperCap) Name() string { return "fake-wrapper" }
func (c fakeWrapperCap) Contribute() []string {
	return []string{
		fakeWrapperMarkerEnv + "=1",
		fakeWrapperModeEnv + "=" + c.mode,
	}
}
func (c fakeWrapperCap) SignatureKey() string { return "fake" }

// spawnFake spawns the fake wrapper in the given mode and returns the agent.
// The subprocess is killed and reaped at test cleanup (the pool's exit watcher
// owns Wait in production; the test stands in for it).
func spawnFake(t *testing.T, mode string, readinessTimeout time.Duration) *Agent {
	t.Helper()
	self, err := os.Executable()
	if err != nil {
		t.Fatalf("resolve test binary: %v", err)
	}
	agent := NewAgent(readinessTimeout)
	ctx, cancel := context.WithCancel(context.Background())
	cmd, err := agent.Spawn(ctx, SpawnInput{
		BinaryPath:     self,
		ConversationID: "conv-test",
		Home:           t.TempDir(),
		Runner:         testRunner{},
		Capabilities:   []app.Capability{fakeWrapperCap{mode: mode}},
	})
	if err != nil {
		cancel()
		t.Fatalf("spawn fake wrapper: %v", err)
	}
	t.Cleanup(func() {
		_ = cmd.Process.Kill()
		_ = cmd.Wait()
		cancel()
	})
	return agent
}
