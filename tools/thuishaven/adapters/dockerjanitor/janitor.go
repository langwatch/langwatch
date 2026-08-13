// Package dockerjanitor removes containers a testcontainers run left behind in
// the shared colima VM. The selection rule lives in domain (the testcontainers
// label plus an age cutoff); this adapter only lists and removes.
package dockerjanitor

import (
	"context"
	"os/exec"
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

// ReapTestContainers removes every testcontainers-labeled container created
// before cutoff and returns the removed containers' names. When the VM is not
// running there is nothing to leak resources into, so the sweep does nothing
// rather than start it.
func (j *Janitor) ReapTestContainers(ctx context.Context, cutoff time.Time) ([]string, error) {
	if !j.rt.IsRunning(ctx) {
		return nil, nil
	}
	dockerHost, err := j.rt.DockerHost(ctx)
	if err != nil {
		return nil, err
	}
	out, err := j.rt.Docker(ctx, dockerHost, "ps", "-a",
		"--filter", "label="+domain.TestContainersLabel,
		"--format", "{{.ID}}\t{{.CreatedAt}}\t{{.Names}}").Output()
	if err != nil {
		return nil, err
	}
	leaked := domain.LeakedTestContainers(domain.ParseTestContainerListing(string(out)), cutoff)
	if len(leaked) == 0 {
		return nil, nil
	}
	args := []string{"rm", "-f", "-v"}
	names := make([]string, 0, len(leaked))
	for _, c := range leaked {
		args = append(args, c.ID)
		names = append(names, c.Name)
	}
	if err := j.rt.Docker(ctx, dockerHost, args...).Run(); err != nil {
		return nil, err
	}
	return names, nil
}
