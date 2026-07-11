// Package colima is the container runtime haven runs the observability stack on.
//
// Colima rather than Docker Desktop: the VM's ceiling is explicit and per-profile
// (so a background telemetry stack can never quietly take the machine), it needs
// no license, and it is what this repo already standardizes on locally. haven
// talks to it by pinning DOCKER_HOST to the profile's own socket, so it never
// depends on which docker context happens to be selected.
package colima

import (
	"context"
	"encoding/json"
	"fmt"
	"os"
	"os/exec"
	"strings"

	"github.com/langwatch/langwatch/tools/thuishaven/domain"
)

// Runtime drives one colima profile.
type Runtime struct {
	profile string
	limits  domain.ColimaLimits
}

// New builds a Runtime for a profile. limits are only applied when haven has to
// create the profile itself.
func New(profile string, limits domain.ColimaLimits) *Runtime {
	if profile == "" {
		profile = "default"
	}
	return &Runtime{profile: profile, limits: limits}
}

// Profile is the colima profile this runtime drives.
func (r *Runtime) Profile() string { return r.profile }

// profileStatus is the subset of `colima list --json` haven reads.
type profileStatus struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// Ensure guarantees the VM is up and returns the DOCKER_HOST that addresses its
// daemon. A profile that does not exist yet is created with haven's limits; one
// that exists is started as its owner configured it, never resized.
func (r *Runtime) Ensure(ctx context.Context) (dockerHost string, err error) {
	if _, err := exec.LookPath("colima"); err != nil {
		return "", fmt.Errorf("colima is not installed — `brew install colima docker` (haven runs the observability stack on colima, not Docker Desktop)")
	}

	found, isRunning := r.profileState(ctx)
	switch {
	case isRunning:
	case found:
		// Exists but stopped: start it as-is. Passing --cpu/--memory here would
		// silently resize a VM someone else sized on purpose.
		if err := r.run(ctx, "start", "-p", r.profile); err != nil {
			return "", fmt.Errorf("colima start -p %s: %w", r.profile, err)
		}
	default:
		if err := r.run(ctx, "start", "-p", r.profile,
			"--cpu", fmt.Sprint(r.limits.CPUs),
			"--memory", fmt.Sprint(r.limits.MemoryGiB),
			"--disk", fmt.Sprint(r.limits.DiskGiB),
			"--runtime", "docker",
		); err != nil {
			return "", fmt.Errorf("colima start -p %s (new profile): %w", r.profile, err)
		}
	}
	return r.DockerHost(ctx)
}

// profileState reports whether the profile exists and whether it is running.
func (r *Runtime) profileState(ctx context.Context) (found, isRunning bool) {
	out, err := exec.CommandContext(ctx, "colima", "list", "--json").Output()
	if err != nil {
		return false, false
	}
	// One JSON object per line, not an array.
	for _, line := range strings.Split(strings.TrimSpace(string(out)), "\n") {
		var st profileStatus
		if json.Unmarshal([]byte(line), &st) != nil || st.Name != r.profile {
			continue
		}
		return true, strings.EqualFold(st.Status, "Running")
	}
	return false, false
}

// DockerHost asks colima where the profile's docker socket is, rather than
// assuming the conventional path. It does not start the VM.
func (r *Runtime) DockerHost(ctx context.Context) (string, error) {
	out, err := exec.CommandContext(ctx, "colima", "status", "-p", r.profile, "--json").Output()
	if err != nil {
		return "", fmt.Errorf("colima status -p %s: %w", r.profile, err)
	}
	var st struct {
		DockerSocket string `json:"docker_socket"`
	}
	if err := json.Unmarshal(out, &st); err != nil || st.DockerSocket == "" {
		return "", fmt.Errorf("colima profile %q reports no docker socket", r.profile)
	}
	return st.DockerSocket, nil
}

// IsRunning reports whether the VM is up, without starting it.
func (r *Runtime) IsRunning(ctx context.Context) bool {
	_, isRunning := r.profileState(ctx)
	return isRunning
}

// Docker builds a `docker` command pinned to this profile's socket. Pinned, so a
// stray `docker context use` elsewhere can't send haven's containers to a
// different daemon.
func (r *Runtime) Docker(ctx context.Context, dockerHost string, args ...string) *exec.Cmd {
	cmd := exec.CommandContext(ctx, "docker", args...)
	cmd.Env = append(os.Environ(), "DOCKER_HOST="+dockerHost)
	return cmd
}

func (r *Runtime) run(ctx context.Context, args ...string) error {
	cmd := exec.CommandContext(ctx, "colima", args...)
	// colima's start is slow and chatty; let the user watch it rather than stare
	// at a silent terminal for a minute.
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	return cmd.Run()
}
