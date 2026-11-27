package waitcontainers

import (
	"context"
	"io"
	"os/exec"
	"strings"
)

// CLI runs the docker binary on the runner.
type CLI struct{}

// State reads the container's run state and health with docker inspect.
func (CLI) State(ctx context.Context, name string) (State, error) {
	format := "{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}"
	out, err := exec.CommandContext(ctx, "docker", "inspect", "-f", format, name).Output()
	if err != nil {
		return State{}, err
	}
	status, health, _ := strings.Cut(strings.TrimSpace(string(out)), " ")

	return State{Status: status, Health: health}, nil
}

// Diagnose writes docker ps -a and the container's last log lines.
func (CLI) Diagnose(ctx context.Context, name string, out io.Writer) {
	for _, args := range [][]string{{"ps", "-a"}, {"logs", "--tail", "100", name}} {
		cmd := exec.CommandContext(ctx, "docker", args...)
		cmd.Stdout, cmd.Stderr = out, out
		_ = cmd.Run() // diagnosis only: the wait has already failed
	}
}
