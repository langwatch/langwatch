// Package uvicornchild owns the lifecycle of the Python uvicorn process
// that nlpgo fronts. nlpgo is the entrypoint of the container/Lambda;
// it spawns uvicorn as a child, monitors it, and proxies non-/go/*
// requests to it. If the child dies unexpectedly nlpgo terminates so
// the orchestrator restarts the container.
package uvicornchild

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"sync"
	"sync/atomic"
	"syscall"
	"time"

	"go.uber.org/zap"
)

// Options configures a Manager.
type Options struct {
	// Command is the binary to exec. Default: "uvicorn".
	Command string
	// Args are the arguments to pass to Command. Default targets the
	// langwatch_nlp.main:app FastAPI app on port 5561.
	Args []string
	// HealthURL is the URL nlpgo polls to determine child readiness.
	// Default: "http://127.0.0.1:5561/health".
	HealthURL string
	// StartTimeout caps how long Start() waits for the child to become
	// healthy on first boot. Default: 30s.
	StartTimeout time.Duration
	// HealthTimeout caps each individual health probe. Default: 2s.
	HealthTimeout time.Duration
	// Disabled skips spawning the child entirely. Used in dev when an
	// operator runs uvicorn manually, and in tests.
	Disabled bool
	// Env additional env entries to merge with the parent process env
	// when spawning the child.
	Env []string
	// Logger receives lifecycle events.
	Logger *zap.Logger
}

// Manager owns the uvicorn subprocess.
type Manager struct {
	opts    Options
	cmd     *exec.Cmd
	mu      sync.Mutex
	fatalCh chan error
	exited  chan struct{}
	stopped atomic.Bool
	client  *http.Client
}

// New builds a Manager. Configuration is materialized eagerly so a
// caller can observe defaults via the public Options field if needed.
func New(opts Options) *Manager {
	if opts.Command == "" {
		opts.Command = "uvicorn"
	}
	if len(opts.Args) == 0 {
		opts.Args = []string{
			"langwatch_nlp.main:app",
			"--host", "0.0.0.0",
			"--port", "5561",
		}
	}
	if opts.HealthURL == "" {
		opts.HealthURL = "http://127.0.0.1:5561/health"
	}
	if opts.StartTimeout == 0 {
		opts.StartTimeout = 30 * time.Second
	}
	if opts.HealthTimeout == 0 {
		opts.HealthTimeout = 2 * time.Second
	}
	if opts.Logger == nil {
		opts.Logger = zap.NewNop()
	}
	return &Manager{
		opts:    opts,
		fatalCh: make(chan error, 1),
		exited:  make(chan struct{}),
		client:  &http.Client{Timeout: opts.HealthTimeout},
	}
}

// Start spawns the child process and blocks until the health endpoint
// responds OK or StartTimeout elapses. After Start returns, a goroutine
// watches the process; an unexpected exit pushes onto Fatal().
func (m *Manager) Start(ctx context.Context) error {
	if m.opts.Disabled {
		m.opts.Logger.Info("uvicorn_child_disabled")
		return nil
	}

	m.mu.Lock()
	if m.cmd != nil {
		m.mu.Unlock()
		return errors.New("uvicornchild: already started")
	}
	cmd := exec.Command(m.opts.Command, m.opts.Args...) //nolint:gosec // command is operator-configured
	cmd.Env = append(cmd.Environ(), m.opts.Env...)
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	cmd.Stdout = newLogWriter(m.opts.Logger, "uvicorn_stdout")
	cmd.Stderr = newLogWriter(m.opts.Logger, "uvicorn_stderr")
	if err := cmd.Start(); err != nil {
		m.mu.Unlock()
		return fmt.Errorf("uvicornchild: start: %w", err)
	}
	m.cmd = cmd
	m.mu.Unlock()

	go m.watch(cmd)

	startCtx, cancel := context.WithTimeout(ctx, m.opts.StartTimeout)
	defer cancel()
	if err := m.waitHealthy(startCtx); err != nil {
		// Best effort kill so we don't leak the child if we can't
		// confirm it's healthy in time.
		_ = m.killProcess()
		return fmt.Errorf("uvicornchild: not healthy within %s: %w", m.opts.StartTimeout, err)
	}
	m.opts.Logger.Info("uvicorn_child_ready")
	return nil
}

// Stop signals the child process group and waits for it to exit. Safe
// to call multiple times.
func (m *Manager) Stop() {
	if m.opts.Disabled {
		return
	}
	if m.stopped.Swap(true) {
		return
	}
	if err := m.killProcess(); err != nil {
		m.opts.Logger.Warn("uvicorn_child_stop_error", zap.Error(err))
	}
}

// Healthy probes the child's /health endpoint. Returns nil on 2xx.
func (m *Manager) Healthy(ctx context.Context) error {
	if m.opts.Disabled {
		return nil
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, m.opts.HealthURL, nil)
	if err != nil {
		return err
	}
	resp, err := m.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("uvicornchild: health %d", resp.StatusCode)
	}
	return nil
}

// Fatal returns the channel that emits when the child exits
// unexpectedly. Closed only if the manager itself is torn down.
func (m *Manager) Fatal() <-chan error { return m.fatalCh }

func (m *Manager) waitHealthy(ctx context.Context) error {
	tick := time.NewTicker(250 * time.Millisecond)
	defer tick.Stop()
	for {
		if err := m.Healthy(ctx); err == nil {
			return nil
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-tick.C:
		}
	}
}

func (m *Manager) watch(cmd *exec.Cmd) {
	err := cmd.Wait()
	close(m.exited)
	if m.stopped.Load() {
		return
	}
	if err == nil {
		err = errors.New("uvicornchild: exited cleanly without Stop()")
	} else {
		err = fmt.Errorf("uvicornchild: exited unexpectedly: %w", err)
	}
	m.opts.Logger.Error("uvicorn_child_exited", zap.Error(err))
	select {
	case m.fatalCh <- err:
	default:
	}
}

func (m *Manager) killProcess() error {
	m.mu.Lock()
	cmd := m.cmd
	m.mu.Unlock()
	if cmd == nil || cmd.Process == nil {
		return nil
	}
	// Kill the whole process group so any uvicorn workers go too.
	pgid, err := syscall.Getpgid(cmd.Process.Pid)
	if err != nil {
		return cmd.Process.Kill()
	}
	if err := syscall.Kill(-pgid, syscall.SIGTERM); err != nil {
		return err
	}
	// Wait briefly for graceful exit; escalate to SIGKILL otherwise.
	// The watch() goroutine is the only owner of cmd.Wait(); it closes
	// m.exited when the child reaps. Calling cmd.Wait() a second time
	// here returned immediately with an error (the process is already
	// gone from this goroutine's perspective), short-circuiting the
	// 5-second timer and silently skipping SIGKILL.
	select {
	case <-m.exited:
	case <-time.After(5 * time.Second):
		_ = syscall.Kill(-pgid, syscall.SIGKILL)
		<-m.exited
	}
	return nil
}

type logWriter struct {
	logger *zap.Logger
	field  string
}

func newLogWriter(l *zap.Logger, field string) *logWriter { return &logWriter{logger: l, field: field} }

func (w *logWriter) Write(p []byte) (int, error) {
	if len(p) == 0 {
		return 0, nil
	}
	w.logger.Info("uvicorn_child_log", zap.String("stream", w.field), zap.ByteString("line", p))
	return len(p), nil
}
