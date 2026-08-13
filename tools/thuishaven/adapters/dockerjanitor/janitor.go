// Package dockerjanitor removes containers a testcontainers run left behind in
// the shared colima VM. The selection rules live in domain (the testcontainers
// label, the Ryuk exclusion, and the stopped/running age cutoffs); this adapter
// only lists and removes.
package dockerjanitor

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"time"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// runtime is the slice of *colima.Runtime the janitor needs. IsRunning comes
// first on purpose: a sweep is hygiene, never a reason to boot the VM.
type runtime interface {
	IsRunning(ctx context.Context) bool
	DockerHost(ctx context.Context) (string, error)
	Docker(ctx context.Context, dockerHost string, args ...string) *exec.Cmd
}

// Janitor implements the app's ContainerJanitor port against the colima VM.
type Janitor struct {
	rt runtime
}

// New wraps the colima runtime (or anything satisfying its listing/removal
// slice) in a Janitor.
func New(rt runtime) *Janitor { return &Janitor{rt: rt} }

// listingFormat asks docker for exactly the fields domain's parser expects,
// tab-separated, labels last (they contain commas but never tabs).
const listingFormat = "{{.ID}}\t{{.State}}\t{{.CreatedAt}}\t{{.Names}}\t{{.Labels}}"

// ReapTestContainers removes every reapable testcontainers-labeled container
// (stopped ones older than stoppedCutoff, running ones older than
// runningCutoff — see domain.LeakedTestContainers) and returns the removed
// containers' names. Removal is per container, so one failure — most often a
// benign race with a run cleaning up its own container — neither aborts the
// sweep nor hides what was actually reaped: the successes are returned
// alongside the joined errors. When the VM is not running there is nothing
// leaking resources, so the sweep does nothing rather than start it.
func (j *Janitor) ReapTestContainers(ctx context.Context, stoppedCutoff, runningCutoff time.Time) ([]string, error) {
	if !j.rt.IsRunning(ctx) {
		return nil, nil
	}
	dockerHost, err := j.rt.DockerHost(ctx)
	if err != nil {
		return nil, err
	}
	out, err := j.rt.Docker(ctx, dockerHost, "ps", "-a",
		"--filter", "label="+domain.TestContainersLabel,
		"--format", listingFormat).Output()
	if err != nil {
		return nil, describeExecErr("docker ps", err)
	}
	containers, unparseable := domain.ParseTestContainerListing(string(out))
	if unparseable > 0 && len(containers) == 0 {
		// Every labeled row failed to parse: the CLI's output format has
		// changed and the sweep is blind. Silence here would look exactly like
		// "nothing leaked", forever.
		return nil, fmt.Errorf("could not date any of %d listed test containers — docker ps output format changed?", unparseable)
	}
	leaked := domain.LeakedTestContainers(containers, stoppedCutoff, runningCutoff)

	var names []string
	var errs []error
	for _, c := range leaked {
		rmOut, rmErr := j.rt.Docker(ctx, dockerHost, "rm", "-f", "-v", c.ID).CombinedOutput()
		if rmErr != nil && !strings.Contains(string(rmOut), "No such container") {
			errs = append(errs, fmt.Errorf("rm %s: %w: %s", c.Name, rmErr, bytes.TrimSpace(rmOut)))
			continue
		}
		names = append(names, c.Name)
	}
	return names, errors.Join(errs...)
}

// describeExecErr keeps the one diagnostic a failed docker call produces:
// exec.Cmd.Output discards stderr from the error text, so without this every
// failure reaches the daemon's log as a bare "exit status 1".
func describeExecErr(what string, err error) error {
	var ee *exec.ExitError
	if errors.As(err, &ee) && len(ee.Stderr) > 0 {
		return fmt.Errorf("%s: %w: %s", what, err, bytes.TrimSpace(ee.Stderr))
	}
	return fmt.Errorf("%s: %w", what, err)
}
