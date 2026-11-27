package waitcontainers

import (
	"bytes"
	"context"
	"errors"
	"io"
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// fakeDocker answers each container's health from a scripted sequence, repeating the last.
type fakeDocker struct {
	statuses  map[string][]string
	diagnosed []string
}

func (f *fakeDocker) Health(_ context.Context, name string) (string, error) {
	seq, ok := f.statuses[name]
	if !ok {
		return "", errors.New("no such container: " + name)
	}
	status := seq[0]
	if len(seq) > 1 {
		f.statuses[name] = seq[1:]
	}

	return status, nil
}

func (f *fakeDocker) Diagnose(_ context.Context, name string, out io.Writer) {
	f.diagnosed = append(f.diagnosed, name)
	_, _ = io.WriteString(out, "logs of "+name+"\n")
}

// @scenario "A container wait passes once every container is healthy"
func TestWaitPassesOnceEveryContainerIsHealthy(t *testing.T) {
	docker := &fakeDocker{statuses: map[string][]string{
		"postgres": {"starting", "starting", "healthy"},
		"redis":    {"healthy"},
	}}
	var log bytes.Buffer
	w := Waiter{Names: []string{"postgres", "redis"}, Docker: docker, Interval: time.Millisecond, Timeout: time.Second, Log: &log}

	require.NoError(t, w.Wait(context.Background()))
	assert.Contains(t, log.String(), "postgres is healthy")
	assert.Contains(t, log.String(), "redis is healthy")
	assert.Empty(t, docker.diagnosed)
}

// @scenario "A container that never becomes healthy fails the wait with its logs"
func TestWaitFailsWithTheLogsOfAContainerThatNeverBecomesHealthy(t *testing.T) {
	startLog := filepath.Join(t.TempDir(), "datastores.log")
	require.NoError(t, os.WriteFile(startLog, []byte("pull access denied for postgres\n"), 0o600))
	docker := &fakeDocker{statuses: map[string][]string{"postgres": {"unhealthy"}}}
	var log bytes.Buffer
	w := Waiter{Names: []string{"postgres"}, StartLog: startLog, Docker: docker, Interval: time.Millisecond, Timeout: 20 * time.Millisecond, Log: &log}

	err := w.Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), `postgres is not healthy after 20ms (last status "unhealthy")`)
	assert.Contains(t, log.String(), "pull access denied for postgres")
	assert.Contains(t, log.String(), "logs of postgres")
	assert.Equal(t, []string{"postgres"}, docker.diagnosed)
}

func TestWaitNamesAContainerThatWasNeverCreated(t *testing.T) {
	w := Waiter{Names: []string{"clickhouse"}, Docker: &fakeDocker{}, Interval: time.Millisecond, Timeout: 10 * time.Millisecond, Log: io.Discard}

	err := w.Wait(context.Background())

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not created yet: the image may still be pulling")
}

func TestValidateRefusesAWaitThatCouldNeverPass(t *testing.T) {
	require.Error(t, (&Waiter{Timeout: time.Second}).Validate())
	require.Error(t, (&Waiter{Names: []string{"redis"}}).Validate())
	require.NoError(t, (&Waiter{Names: []string{"redis"}, Timeout: time.Second}).Validate())
}
