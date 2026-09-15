package app

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"os/exec"
	"path/filepath"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// onceJob is one one-shot lane to run: which stack it belongs to, what it is
// called in the log, and the command itself.
type onceJob struct {
	Slug  string
	Name  string
	Dir   string
	Shell string
	Env   []string
}

// runOnceJob runs a one-shot lane and journals the run. The journal is the only
// record that a prepare, a seed or an image build ever happened: the lanes are
// not supervised children, so nothing else in the stack remembers them, and an
// up that took four minutes is otherwise four minutes nobody can account for.
//
// Journalling is best-effort by contract. A run whose record cannot be written
// still ran, and failing the up over an unwritable log line would be absurd.
func (o *Orchestrator) runOnceJob(ctx context.Context, job onceJob) error {
	started := o.sys.Now()
	err := o.sup.RunOnce(ctx, job.Name, job.Dir, job.Shell, job.Env)
	o.journalOnceJob(job.Slug, domain.OnceJobRun{
		Name:       job.Name,
		At:         started,
		DurationMS: o.sys.Now().Sub(started).Milliseconds(),
		Exit:       exitStatus(err),
	})
	return err
}

// exitStatus reads a failed run's process exit status. A failure that never
// reached a process at all (the shell could not start) has no status of its
// own, so it is reported as 1 - it failed, and the reason is in the lane's own
// output rather than in a number.
func exitStatus(err error) int {
	if err == nil {
		return 0
	}
	var exit *exec.ExitError
	if errors.As(err, &exit) {
		return exit.ExitCode()
	}
	return 1
}

// journalOnceJob appends one record to the stack's job journal.
func (o *Orchestrator) journalOnceJob(slug string, run domain.OnceJobRun) {
	if slug == "" || o.cfg.Home == "" {
		return
	}
	dir := filepath.Join(o.cfg.Home, "logs", slug)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return
	}
	encoded, err := json.Marshal(run)
	if err != nil {
		return
	}
	path := filepath.Join(dir, domain.OnceJobJournal)
	file, err := os.OpenFile(path, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0o600)
	if err != nil {
		return
	}
	defer func() { _ = file.Close() }()
	_, _ = file.Write(append(encoded, '\n'))
}
