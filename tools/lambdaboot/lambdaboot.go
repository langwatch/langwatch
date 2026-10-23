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
// Docker enters the working directory before it drops to the foreign user and
// Lambda does not, so a boot alone cannot see a working directory that user may
// not enter; the check reads the image's directory modes for that first.
//
// It runs the image's entrypoint directly, so it proves the process starts and
// serves its health check as a foreign user, not the Lambda adapter in front
// of it.
// Spec: specs/ci/publish-ecr-images.feature
package lambdaboot

import (
	"bytes"
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
	// User is the numeric uid:gid to run as. It must not be root, and should
	// not be the image's own USER, or it proves nothing about Lambda's user.
	User string
	Port int
	Path string
	Env  []string
	// Timeout bounds the whole check, docker calls included.
	Timeout  time.Duration
	Interval time.Duration
}

// Docker runs one docker subcommand and returns its trimmed stdout.
type Docker func(ctx context.Context, args ...string) (string, error)

// Probe GETs a URL and returns its status code.
type Probe func(ctx context.Context, url string) (int, error)

// Runtime is what the check reads images, starts containers and calls the
// health check with.
type Runtime struct {
	Docker Docker
	Probe  Probe
	Stat   Stat
}

// Real is the docker CLI on PATH and a plain HTTP GET.
var Real = Runtime{Docker: DockerCLI, Probe: HTTPProbe, Stat: StatCLI}

// DockerCLI runs the docker binary on PATH and returns its stdout alone, so
// a warning docker prints on stderr never reads as a container id or a port.
// `logs` is the one subcommand whose stderr is the answer: a container's own
// stderr comes back on docker's.
func DockerCLI(ctx context.Context, args ...string) (string, error) {
	cmd := exec.CommandContext(ctx, "docker", args...)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	text := strings.TrimSpace(string(out))
	if err != nil {
		return text, fmt.Errorf("docker %s: %w: %s", args[0], err, strings.TrimSpace(stderr.String()))
	}
	if args[0] == "logs" {
		text = strings.TrimSpace(text + "\n" + stderr.String())
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

// Check confirms the user may enter the image's working directory, then
// starts the image, waits for its health check to answer 200 and removes the
// container. It fails, with the container's output when it has any, when the
// working directory is closed to the user, the image cannot start, its process
// exits, or the health check does not answer, all within the timeout.
func Check(ctx context.Context, opts Options, rt Runtime) error {
	u, err := parseUser(opts.User)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()
	c := check{opts: opts, rt: rt, user: u}
	if err := c.workdir(ctx); err != nil {
		return err
	}
	return c.boot(ctx)
}

// check is one image under check, as one user.
type check struct {
	opts Options
	rt   Runtime
	user user
}

// boot starts the image within the bound. Cleanup and the container output
// drop the bound, so they still run once it has passed.
func (k check) boot(ctx context.Context) error {
	// Named before it starts, so a run that fails after creating the
	// container still removes it.
	name := fmt.Sprintf("lambdaboot-%d", time.Now().UnixNano())
	defer func() { _, _ = k.rt.Docker(context.WithoutCancel(ctx), "rm", "-f", name) }()
	if _, err := k.rt.Docker(ctx, runArgs(k.opts, name)...); err != nil {
		return fmt.Errorf("%s could not start as user %s: %w", k.opts.Image, k.opts.User, err)
	}

	c := container{id: name, opts: k.opts, rt: k.rt}
	if err := c.waitHealthy(ctx); err != nil {
		logs, _ := k.rt.Docker(context.WithoutCancel(ctx), "logs", name)
		return fmt.Errorf("%s: %w\n--- container output ---\n%s", k.opts.Image, err, logs)
	}
	return nil
}

// container is one started container under check.
type container struct {
	id   string
	opts Options
	rt   Runtime
}

// user is a numeric uid:gid other than root.
type user struct{ uid, gid int }

func (u user) String() string { return strconv.Itoa(u.uid) + ":" + strconv.Itoa(u.gid) }

// parseUser accepts only a numeric uid:gid with a positive uid, so no
// spelling of root (0, 00, +0, root) and no name the image might resolve to
// root gets through.
func parseUser(s string) (user, error) {
	refuse := fmt.Errorf("the boot check must run as a numeric non-root uid:gid other than the image's own, got %q", s)
	uidText, gidText, ok := strings.Cut(s, ":")
	if !ok {
		return user{}, refuse
	}
	uid, err := strconv.Atoi(uidText)
	if err != nil || uid <= 0 || strings.HasPrefix(uidText, "+") {
		return user{}, refuse
	}
	gid, err := strconv.Atoi(gidText)
	if err != nil || gid < 0 || strings.HasPrefix(gidText, "+") {
		return user{}, refuse
	}
	return user{uid: uid, gid: gid}, nil
}

func runArgs(opts Options, name string) []string {
	port := strconv.Itoa(opts.Port)
	args := []string{
		"run", "--detach", "--name", name,
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
	for {
		if status, err := c.rt.Probe(ctx, url); err == nil && status == http.StatusOK {
			return nil
		}
		if ctx.Err() != nil {
			return c.timedOut()
		}
		if err := c.stillRunning(ctx); err != nil {
			return err
		}
		if sleep(ctx, c.opts.Interval) != nil {
			return c.timedOut()
		}
	}
}

func (c container) timedOut() error {
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
		// A process that exits at once leaves no published port: say that.
		if err := c.stillRunning(ctx); err != nil {
			return "", err
		}
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
