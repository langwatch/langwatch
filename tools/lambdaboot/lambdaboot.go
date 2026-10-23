// Package lambdaboot starts a built Lambda image the way Lambda does and
// reports whether it comes up, before the image is pushed under a tag.
//
// Lambda runs a container image as its own unprivileged user, never the
// image's USER, with a read-only root and only /tmp writable. An image that is
// valid everywhere else can fail every start there: one that started in a
// home directory only its own user could enter shipped and broke every studio
// workflow it reached. tools/ciguard reads the Dockerfile for that one cause;
// this check proves the image starts, whatever would have stopped it.
//
// It runs the image's entrypoint directly, so it proves the process starts and
// serves its health check as a foreign user, not the Lambda adapter in front
// of it.
// Spec: specs/ci/publish-ecr-images.feature
package lambdaboot

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"os/exec"
	"strconv"
	"strings"
	"time"
)

// Options says which image to start and what counts as up.
type Options struct {
	Image string
	// User is the uid:gid to run as. It must not be root, and should not be
	// the image's own USER, or it proves nothing about Lambda's user.
	User     string
	Port     int
	Path     string
	Env      []string
	Timeout  time.Duration
	Interval time.Duration
}

// Docker runs one docker subcommand and returns its trimmed stdout.
type Docker func(ctx context.Context, args ...string) (string, error)

// Probe GETs a URL and returns its status code.
type Probe func(ctx context.Context, url string) (int, error)

// Runtime is what the check starts containers and calls the health check with.
type Runtime struct {
	Docker Docker
	Probe  Probe
}

// Real is the docker CLI on PATH and a plain HTTP GET.
var Real = Runtime{Docker: DockerCLI, Probe: HTTPProbe}

// DockerCLI runs the docker binary on PATH.
func DockerCLI(ctx context.Context, args ...string) (string, error) {
	out, err := exec.CommandContext(ctx, "docker", args...).CombinedOutput()
	text := strings.TrimSpace(string(out))
	if err != nil {
		return text, fmt.Errorf("docker %s: %w: %s", args[0], err, text)
	}
	return text, nil
}

// HTTPProbe GETs the URL with a short per-request timeout.
func HTTPProbe(ctx context.Context, url string) (int, error) {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return 0, err
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return 0, err
	}
	_ = resp.Body.Close()
	return resp.StatusCode, nil
}

// Check starts the image, waits for its health check to answer 200 and
// removes the container. It fails, with the container's output when it has
// any, when the image cannot start, its process exits, or the health check
// does not answer within the timeout.
func Check(ctx context.Context, opts Options, rt Runtime) error {
	if err := validUser(opts.User); err != nil {
		return err
	}
	id, err := rt.Docker(ctx, runArgs(opts)...)
	if err != nil {
		return fmt.Errorf("%s could not start as user %s: %w", opts.Image, opts.User, err)
	}
	defer func() { _, _ = rt.Docker(context.WithoutCancel(ctx), "rm", "-f", id) }()

	c := container{id: id, opts: opts, rt: rt}
	if err := c.waitHealthy(ctx); err != nil {
		logs, _ := rt.Docker(ctx, "logs", id)
		return fmt.Errorf("%s: %w\n--- container output ---\n%s", opts.Image, err, logs)
	}
	return nil
}

// container is one started container under check.
type container struct {
	id   string
	opts Options
	rt   Runtime
}

func validUser(user string) error {
	uid, _, _ := strings.Cut(user, ":")
	if uid == "" || uid == "0" || uid == "root" {
		return fmt.Errorf("the boot check must run as a non-root user other than the image's own, got %q", user)
	}
	return nil
}

func runArgs(opts Options) []string {
	port := strconv.Itoa(opts.Port)
	args := []string{
		"run", "--detach",
		"--user", opts.User,
		"--read-only",
		"--tmpfs", "/tmp:rw,exec,size=512m",
		"-p", "127.0.0.1::" + port,
	}
	for _, kv := range opts.Env {
		args = append(args, "-e", kv)
	}
	return append(args, opts.Image)
}

func (c container) waitHealthy(ctx context.Context) error {
	addr, err := c.publishedAddr(ctx)
	if err != nil {
		return err
	}
	url := "http://" + addr + c.opts.Path
	deadline := time.Now().Add(c.opts.Timeout)
	for time.Now().Before(deadline) {
		if status, err := c.rt.Probe(ctx, url); err == nil && status == http.StatusOK {
			return nil
		}
		if err := c.stillRunning(ctx); err != nil {
			return err
		}
		if err := sleep(ctx, c.opts.Interval); err != nil {
			return err
		}
	}
	return fmt.Errorf("%s did not answer 200 within %s", c.opts.Path, c.opts.Timeout)
}

// publishedAddr is the host address docker bound the container port to,
// preferring the IPv4 line `docker port` prints first.
func (c container) publishedAddr(ctx context.Context) (string, error) {
	out, err := c.rt.Docker(ctx, "port", c.id, strconv.Itoa(c.opts.Port)+"/tcp")
	if err != nil {
		return "", err
	}
	first, _, _ := strings.Cut(out, "\n")
	if first == "" {
		return "", errors.New("docker published no host port for the health check")
	}
	return strings.TrimSpace(first), nil
}

func (c container) stillRunning(ctx context.Context) error {
	out, err := c.rt.Docker(ctx, "inspect", "--format", "{{.State.Running}} {{.State.ExitCode}}", c.id)
	if err != nil {
		return err
	}
	running, code, _ := strings.Cut(out, " ")
	if running != "true" {
		return fmt.Errorf("the process exited with code %s", code)
	}
	return nil
}

func sleep(ctx context.Context, d time.Duration) error {
	timer := time.NewTimer(d)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}
