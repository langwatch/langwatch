// Package waitcontainers holds a CI job until the containers it started in the
// background report healthy, and says why when one does not.
//
// Spec: specs/ci/app-ci-datastores.feature
package waitcontainers

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"strings"
	"time"
)

// Docker is the part of the docker CLI the waiter uses.
type Docker interface {
	// Health returns the container's health status: starting, healthy or unhealthy.
	Health(ctx context.Context, name string) (string, error)
	// Diagnose writes what explains a container that never became healthy.
	Diagnose(ctx context.Context, name string, out io.Writer)
}

// Waiter waits for every named container in turn, within one shared deadline.
type Waiter struct {
	Names    []string
	StartLog string
	Docker   Docker
	Interval time.Duration
	Timeout  time.Duration
	Log      io.Writer
}

// Validate reports a waiter that could never succeed.
func (w *Waiter) Validate() error {
	switch {
	case len(w.Names) == 0:
		return errors.New("no container names given")
	case w.Timeout <= 0:
		return errors.New("the timeout must be positive")
	}

	return nil
}

// Wait returns nil once every container is healthy, or an error naming the first that is
// not healthy by the deadline, after writing the start log and that container's diagnosis.
func (w *Waiter) Wait(ctx context.Context) error {
	ctx, cancel := context.WithTimeout(ctx, w.Timeout)
	defer cancel()
	started := time.Now()
	for _, name := range w.Names {
		if err := w.waitOne(ctx, name); err != nil {
			w.diagnose(name)
			return err
		}
		fmt.Fprintf(w.Log, "%s is healthy (waited %s)\n", name, time.Since(started).Round(time.Second))
	}

	return nil
}

// waitOne polls one container until it is healthy or the context ends.
func (w *Waiter) waitOne(ctx context.Context, name string) error {
	for {
		status, _ := w.Docker.Health(ctx, name)
		if status == "healthy" {
			return nil
		}
		select {
		case <-ctx.Done():
			return fmt.Errorf("%s is not healthy after %s (last status %q)", name, w.Timeout, status)
		case <-time.After(w.Interval):
		}
	}
}

// diagnose writes the start log and the container's own state, on a fresh deadline.
func (w *Waiter) diagnose(name string) {
	if raw, err := os.ReadFile(w.StartLog); err == nil {
		fmt.Fprintf(w.Log, "--- %s\n%s\n", w.StartLog, strings.TrimSpace(string(raw)))
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	w.Docker.Diagnose(ctx, name, w.Log)
}
