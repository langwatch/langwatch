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

// Lanes runs one command to completion under a lane name, so its output lands
// in the same time-and-lane columns as every supervised child. It is the
// supervisor's RunOnce; declared here so this package does not import app.
type Lanes interface {
	RunOnce(ctx context.Context, name, dir, shell string, env []string) error
}

// Runtime drives one colima profile.
type Runtime struct {
	profile string
	limits  domain.ColimaLimits
	lanes   Lanes
}

// New builds a Runtime for a profile. limits are only applied when haven has to
// create the profile itself. lanes is where colima's own chatter (a VM start
// takes a minute and says so in logrus lines) and image pulls are written; a
// nil lanes writes them straight to the terminal.
func New(profile string, limits domain.ColimaLimits, lanes Lanes) *Runtime {
	if profile == "" {
		profile = "default"
	}
	return &Runtime{profile: profile, limits: limits, lanes: lanes}
}

// Profile is the colima profile this runtime drives.
func (r *Runtime) Profile() string { return r.profile }

// Available reports whether a container tier can run on this machine, without
// starting or creating anything: both binaries haven drives — colima for the VM
// and docker for the image build and the worker container — have to be on PATH.
// A stopped profile is still available, because Ensure starts it.
func (r *Runtime) Available(context.Context) bool {
	for _, bin := range []string{"colima", "docker"} {
		if _, err := exec.LookPath(bin); err != nil {
			return false
		}
	}
	return true
}

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

	isFound, isRunning := r.profileState(ctx)
	switch {
	case isRunning:
	case isFound:
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
func (r *Runtime) profileState(ctx context.Context) (isFound, isRunning bool) {
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

// vmStatus is the subset of `colima status --json` haven reads: the socket to
// talk to the daemon on, and the shape the VM was actually given (which is not
// necessarily what DefaultColimaLimits would compute for the host today — see
// Capacity).
type vmStatus struct {
	DockerSocket string `json:"docker_socket"`
	CPU          int    `json:"cpu"`
	MemoryBytes  int64  `json:"memory"`
}

// parseVMStatus decodes `colima status --json`'s output. Split out from status
// so the parsing is testable without shelling out to colima.
func parseVMStatus(data []byte) (vmStatus, error) {
	var st vmStatus
	if err := json.Unmarshal(data, &st); err != nil {
		return vmStatus{}, fmt.Errorf("decoding colima status: %w", err)
	}
	return st, nil
}

// status runs `colima status --json` for this profile and decodes it.
func (r *Runtime) status(ctx context.Context) (vmStatus, error) {
	out, err := exec.CommandContext(ctx, "colima", "status", "-p", r.profile, "--json").Output() //nolint:gosec // G204: r.profile is haven's own configured colima profile name (default "default", or HAVEN_COLIMA_PROFILE), not external input
	if err != nil {
		return vmStatus{}, fmt.Errorf("colima status -p %s: %w", r.profile, err)
	}
	return parseVMStatus(out)
}

// DockerHost asks colima where the profile's docker socket is, rather than
// assuming the conventional path. It does not start the VM.
func (r *Runtime) DockerHost(ctx context.Context) (string, error) {
	st, err := r.status(ctx)
	if err != nil {
		return "", err
	}
	if st.DockerSocket == "" {
		return "", fmt.Errorf("colima profile %q reports no docker socket", r.profile)
	}
	return st.DockerSocket, nil
}

// Capacity reports the CPU count and memory (in MB) the running VM was
// actually given. This can be smaller than what DefaultColimaLimits would
// compute for the host today: Ensure never resizes an existing profile (see
// above), so a VM created on a smaller machine — or sized by hand — keeps
// that shape even after the host gains cores or RAM. A caller that asks the
// daemon for more than this gets docker's own hard refusal ("range of CPUs is
// from 0.01 to N.NN, as there are only N CPUs available"), not a soft cap.
func (r *Runtime) Capacity(ctx context.Context) (cpus int, memoryMB int, err error) {
	st, err := r.status(ctx)
	if err != nil {
		return 0, 0, err
	}
	return st.CPU, int(st.MemoryBytes / (1 << 20)), nil
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

// DockerRun is one docker command whose progress a person watches, and the
// lane column it is shown under.
type DockerRun struct {
	Lane string
	Host string
	Args []string
}

// DockerLane runs one docker command against run.Host with its output in the
// run.Lane column: an image pull is a quiet minute otherwise, and a quiet
// minute reads as a hang.
func (r *Runtime) DockerLane(ctx context.Context, run DockerRun) error {
	if r.lanes == nil {
		cmd := r.Docker(ctx, run.Host, run.Args...)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		return cmd.Run()
	}
	shell := shellJoin(append([]string{"docker"}, run.Args...))
	return r.lanes.RunOnce(ctx, run.Lane, "", shell, []string{"DOCKER_HOST=" + run.Host})
}

// run drives colima itself. Its start is slow and chatty, so the output is
// shown rather than swallowed, under the "colima" lane when there is one.
func (r *Runtime) run(ctx context.Context, args ...string) error {
	if r.lanes == nil {
		cmd := exec.CommandContext(ctx, "colima", args...)
		cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
		return cmd.Run()
	}
	return r.lanes.RunOnce(ctx, "colima", "", shellJoin(append([]string{"colima"}, args...)), nil)
}

// shellJoin renders argv as one bash command line, every word single-quoted so
// the supervisor's `bash -lc` hands the arguments back exactly as given.
func shellJoin(argv []string) string {
	quoted := make([]string, 0, len(argv))
	for _, word := range argv {
		quoted = append(quoted, "'"+strings.ReplaceAll(word, "'", `'\''`)+"'")
	}
	return strings.Join(quoted, " ")
}
