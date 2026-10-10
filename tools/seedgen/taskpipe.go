package seedgen

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"
)

// TaskPipe is the task executor: `pnpm task seed:apply` with the runner plugin, actions on its
// stdin, replies on its stdout. pnpm does not pass fd 3 to the task, so stdout carries the task's
// own log lines too: a line that is not a reply is copied to the log.
type TaskPipe struct {
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	writeMu sync.Mutex
	mu      sync.Mutex
	waiting map[string]chan Reply
	done    chan struct{}
	err     error
}

// RunnerModule is the LANGWATCH_TASK_MODULES entry that adds seed:apply (design §1).
const RunnerModule = "@langwatch/seedgen-runner"

// StartTaskPipe starts the runner in repo with the environment's stack settings; a set
// LANGWATCH_TASK_MODULES (a path to the runner's entry) wins over the package name. extra are
// seed:apply's own options, such as --password-hash-file.
func StartTaskPipe(ctx context.Context, repo string, log io.Writer, extra ...string) (*TaskPipe, error) {
	args := append([]string{"--silent", "task", "seed:apply", "--concurrency", strconv.Itoa(WindowCeil)}, extra...)
	cmd := exec.CommandContext(ctx, "pnpm", args...) //nolint:gosec // a fixed program; extra are seedgen's own options
	cmd.Dir = repo
	cmd.Env = os.Environ()
	if os.Getenv("LANGWATCH_TASK_MODULES") == "" {
		cmd.Env = append(cmd.Env, "LANGWATCH_TASK_MODULES="+RunnerModule)
	}
	cmd.Stderr = log
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} // Close can stop pnpm and the task together
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return nil, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return nil, err
	}
	if err := cmd.Start(); err != nil {
		return nil, err
	}
	pipe := &TaskPipe{cmd: cmd, stdin: stdin, waiting: map[string]chan Reply{}, done: make(chan struct{})}
	go pipe.read(stdout, log)
	return pipe, nil
}

func (p *TaskPipe) read(stdout io.Reader, log io.Writer) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 64<<10), 4<<20)
	for scanner.Scan() {
		reply, ok := parseReply(scanner.Bytes())
		if !ok {
			_, _ = fmt.Fprintln(log, scanner.Text())
			continue
		}
		p.mu.Lock()
		waiter := p.waiting[reply.ID]
		delete(p.waiting, reply.ID)
		p.mu.Unlock()
		if waiter != nil {
			waiter <- reply
		}
	}
	err := p.cmd.Wait()
	p.mu.Lock()
	p.err = fmt.Errorf("seed:apply exited: %w", errors.Join(err, scanner.Err(), errors.New("see its log above")))
	p.mu.Unlock()
	close(p.done)
}

// parseReply accepts only a strict reply line: an id, a boolean ok, and a code on a refusal.
func parseReply(line []byte) (Reply, bool) {
	var reply Reply
	decoder := json.NewDecoder(strings.NewReader(string(line)))
	decoder.DisallowUnknownFields()
	if decoder.Decode(&reply) != nil || reply.ID == "" || (!reply.OK && reply.Code == "") {
		return Reply{}, false
	}
	return reply, true
}

// Send writes the action and waits for the reply with its id.
func (p *TaskPipe) Send(ctx context.Context, action Action) (Reply, error) {
	waiter := make(chan Reply, 1)
	p.mu.Lock()
	if p.err != nil {
		p.mu.Unlock()
		return Reply{}, p.err
	}
	p.waiting[action.ID] = waiter
	p.mu.Unlock()
	p.writeMu.Lock()
	err := WriteAction(p.stdin, action)
	p.writeMu.Unlock()
	if err != nil {
		return Reply{}, err
	}
	select {
	case reply := <-waiter:
		return reply, nil
	case <-p.done:
		return Reply{}, p.err
	case <-ctx.Done():
		p.mu.Lock()
		delete(p.waiting, action.ID)
		p.mu.Unlock()
		return Reply{}, ctx.Err()
	}
}

// Close ends stdin, so the runner finishes what it holds and exits; a runner still busy after
// closeGrace (its writes blocked on a full store) is killed with its process group.
func (p *TaskPipe) Close() error {
	_ = p.stdin.Close()
	select {
	case <-p.done:
	case <-time.After(closeGrace):
		_ = syscall.Kill(-p.cmd.Process.Pid, syscall.SIGKILL)
		<-p.done
	}
	return nil
}

const closeGrace = 30 * time.Second
