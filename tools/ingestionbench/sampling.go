package ingestionbench

// Resource sampling. Informational only — nothing here can fail a run, because
// a number measured on a contended runner is not evidence of anything.

import (
	"context"
	"os/exec"
	"strconv"
	"strings"
	"sync"
	"time"
)

// sampleResources reads `kubectl top pod` once.
//
// Best-effort: metrics-server can be briefly unavailable, and a missing sample
// must never fail the run — resource data is informational.
func sampleResources(ctx context.Context, namespace string) []ResourceSample {
	command := exec.CommandContext(ctx, "kubectl", "top", "pod", "-n", namespace, "--no-headers")
	output, err := command.Output()
	if err != nil {
		return nil
	}

	atMs := time.Now().UnixMilli()
	var samples []ResourceSample
	for _, line := range strings.Split(strings.TrimSpace(string(output)), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 3 {
			continue
		}
		samples = append(samples, ResourceSample{
			AtMs:          atMs,
			Target:        fields[0],
			CPUMillicores: leadingInt(fields[1]),
			MemoryBytes:   int64(leadingInt(fields[2])) * 1024 * 1024,
		})
	}
	return samples
}

// leadingInt reads the numeric prefix of a `kubectl top` cell ("142m", "83Mi").
func leadingInt(value string) int {
	end := 0
	for end < len(value) && value[end] >= '0' && value[end] <= '9' {
		end++
	}
	if end == 0 {
		return 0
	}
	parsed, err := strconv.Atoi(value[:end])
	if err != nil {
		return 0
	}
	return parsed
}

// startSampling polls `kubectl top` every 5s until the returned stop function
// is called, which hands back everything collected.
func startSampling(ctx context.Context, namespace string) func() []ResourceSample {
	var (
		mu      sync.Mutex
		samples []ResourceSample
	)
	done := make(chan struct{})
	finished := make(chan struct{})

	go func() {
		defer close(finished)
		ticker := time.NewTicker(5 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ticker.C:
				collected := sampleResources(ctx, namespace)
				mu.Lock()
				samples = append(samples, collected...)
				mu.Unlock()
			case <-done:
				return
			case <-ctx.Done():
				return
			}
		}
	}()

	var once sync.Once
	return func() []ResourceSample {
		once.Do(func() {
			close(done)
			<-finished
		})
		mu.Lock()
		defer mu.Unlock()
		return append([]ResourceSample(nil), samples...)
	}
}
