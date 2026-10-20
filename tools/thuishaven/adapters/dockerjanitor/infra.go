package dockerjanitor

import (
	"bytes"
	"context"
	"fmt"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// infraListingFormat is what domain.ParseInfraContainerListing reads.
const infraListingFormat = "{{.ID}}\t{{.Names}}\t{{.Image}}\t{{.Ports}}\t{{.Labels}}"

// InfraContainers lists the VM's running containers for the duplicate sweep;
// a VM that is not running has none, and is never started to find out.
func (j *Janitor) InfraContainers(ctx context.Context) ([]domain.InfraContainer, error) {
	if !j.rt.IsRunning(ctx) {
		return nil, nil
	}
	dockerHost, err := j.rt.DockerHost(ctx)
	if err != nil {
		return nil, err
	}
	out, err := j.rt.Docker(ctx, dockerHost, "ps", "--format", infraListingFormat).Output()
	if err != nil {
		return nil, describeExecErr("docker ps", err)
	}
	return domain.ParseInfraContainerListing(string(out)), nil
}

// StopContainer stops one container and keeps it and its volumes: a stray
// copy's data stays for whoever wants it back.
func (j *Janitor) StopContainer(ctx context.Context, id string) error {
	dockerHost, err := j.rt.DockerHost(ctx)
	if err != nil {
		return err
	}
	out, err := j.rt.Docker(ctx, dockerHost, "stop", id).CombinedOutput()
	if err != nil && !strings.Contains(string(out), "No such container") {
		return fmt.Errorf("docker stop %s: %w: %s", id, err, bytes.TrimSpace(out))
	}
	return nil
}
