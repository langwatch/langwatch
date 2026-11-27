package waitcontainers

import (
	"context"
	"io"
	"os/exec"
	"strings"
)

// CLI runs the docker binary on the runner.
type CLI struct{}

// Health reads the container's health status with docker inspect.
func (CLI) Health(ctx context.Context, name string) (string, error) {
	out, err := exec.CommandContext(ctx, "docker", "inspect", "-f", "{{.State.Health.Status}}", name).Output()

	return strings.TrimSpace(string(out)), err
}

// Diagnose writes docker ps -a and the container's last log lines.
func (CLI) Diagnose(ctx context.Context, name string, out io.Writer) {
	for _, args := range [][]string{{"ps", "-a"}, {"logs", "--tail", "100", name}} {
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Stdout, cmd.Stderr = out, out
		_ = cmd.Run() // diagnosis only: the wait has already failed
	}
}
