package visualdiff

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

// PendingBaseFile is where a staggered base's address reaches the runner:
// the runner starts the candidate at once and opens the base when this file
// appears, or stops with the error it carries.
const PendingBaseFile = "base-side.json"

// PendingSide is the content of PendingBaseFile.
type PendingSide struct {
	BaseURL   string            `json:"baseUrl,omitempty"`
	Fixtures  map[string]string `json:"fixtures,omitempty"`
	StaticDir string            `json:"staticDir,omitempty"`
	Error     string            `json:"error,omitempty"`
}

// staggers reports a run whose candidate may capture before its base is up:
// both sides boot live on haven, and the first edition is the one the seed
// wrote, so no license switch has to wait for the base.
func staggers(plan Plan, options Options) bool {
	return options.UseHaven && !plan.ReplayBase && !options.Resume &&
		len(options.Editions) > 0 && options.Editions[0] == EditionEnterprise
}

// claimWorktrees points each side at its persistent worktree, on the haven
// path, unless another live or kept run holds it (worktrees.go). A resumed
// run takes back only the worktrees it held when it was kept.
func claimWorktrees(plan *Plan, options Options) error {
	if !options.UseHaven {
		return nil
	}
	for _, stack := range []*Stack{&plan.Base, &plan.Candidate} {
		if options.Resume {
			if dir := PersistentWorktree(options.Root, stack.Name); worktreeOwner(dir) == options.RunDir {
				stack.Dir, stack.Persistent = dir, true
			}
			continue
		}
		dir, persistent, err := claimWorktree(options.Root, options.RunDir, stack.Name)
		if err != nil {
			return fmt.Errorf("claim the %s worktree: %w", stack.Name, err)
		}
		stack.Dir, stack.Persistent = dir, persistent
	}
	return nil
}

// forwardBase writes the base's address for the runner the moment the base is
// ready, and hands the arrival on for the run to adopt once capture ends.
func (run *session) forwardBase(ctx context.Context, pending string) <-chan baseArrival {
	from, stderr, static := run.baseArrival, run.streams.Err, run.staticDirs[run.plan.Base.Name]
	to := make(chan baseArrival, 1)
	go func() {
		var arrival baseArrival
		select {
		case arrival = <-from:
		case <-ctx.Done():
			arrival = baseArrival{err: ctx.Err()}
		}
		side := PendingSide{BaseURL: arrival.stack.URL(), Fixtures: arrival.fixtures, StaticDir: static}
		if arrival.err != nil {
			side = PendingSide{Error: arrival.err.Error()}
		}
		if err := writePendingSide(pending, side); err != nil {
			fmt.Fprintf(stderr, "base: could not hand the runner its address: %v\n", err)
		}
		to <- arrival
	}()
	return to
}

// writePendingSide writes the file whole, through a rename, so the runner
// never reads half of it.
func writePendingSide(path string, side PendingSide) error {
	encoded, err := json.Marshal(side)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o750); err != nil {
		return err
	}
	staging := path + ".tmp"
	if err := os.WriteFile(staging, encoded, 0o600); err != nil {
		return err
	}
	return os.Rename(staging, path)
}

// adoptBase takes the staggered base into the run once capture ends: its
// address for the report, its fixtures for the seed marker and later passes.
func (run *session) adoptBase(ctx context.Context, arrived <-chan baseArrival) error {
	var arrival baseArrival
	select {
	case arrival = <-arrived:
	case <-ctx.Done():
		return ctx.Err()
	}
	run.baseArrival = nil
	if arrival.err != nil {
		return arrival.err
	}
	run.plan.Base = arrival.stack
	if run.sideFixtures == nil {
		run.sideFixtures = map[string]map[string]string{}
	}
	run.sideFixtures[arrival.stack.Name] = arrival.fixtures
	encoded, err := json.Marshal(run.sideFixtures)
	if err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(run.request.Options.RunDir, "seeded"), encoded, 0o600)
}

// detachCommand starts spec in its own process group, so it outlives the run
// and a Ctrl-C to the run does not reach it, its output appended to log.
func detachCommand(spec commandSpec, log string) error {
	if !allowedCommands[spec.name] {
		return fmt.Errorf("refusing to run unlisted command %q", spec.name)
	}
	output, err := os.OpenFile(log, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o600) // #nosec G304 -- the run's own teardown log.
	if err != nil {
		return err
	}
	defer output.Close()
	// #nosec G204 -- spec.name is restricted to the allowedCommands allowlist above.
	command := exec.CommandContext(context.Background(), spec.name, spec.args...)
	command.Dir, command.Stdout, command.Stderr = spec.dir, output, output
	if spec.env != nil {
		command.Env = spec.env
	}
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	if err := command.Start(); err != nil {
		return err
	}
	return command.Process.Release()
}
