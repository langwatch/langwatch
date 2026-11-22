package chartheap

import (
	"bufio"
	"bytes"
	"context"
	"errors"
	"fmt"
	"os"
	"os/exec"
	"strconv"
	"strings"
)

// ProofLimitBytes is the container memory limit the Node proof runs under.
const ProofLimitBytes = 1 << 30

// The share of ProofLimitBytes a heap under Ceiling must land in: three quarters, plus
// the young generation V8 adds on top of the old space the flag sizes.
const (
	minCeilingShare = 0.70
	maxCeilingShare = 0.85
)

// Runner runs a command and answers its standard output.
type Runner func(name string, args ...string) (string, error)

// NodeImage answers the Node image the app's runtime stage starts from: the last
// `FROM node:` line of the Dockerfile.
func NodeImage(dockerfile string) (string, error) {
	file, err := os.Open(dockerfile)
	if err != nil {
		return "", err
	}
	defer file.Close()
	image := ""
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) >= 2 && strings.EqualFold(fields[0], "FROM") && strings.HasPrefix(fields[1], "node:") {
			image = fields[1]
		}
	}
	if err := scanner.Err(); err != nil {
		return "", err
	}
	if image == "" {
		return "", fmt.Errorf("no FROM node: line in %s", dockerfile)
	}
	return image, nil
}

// ProveCeiling starts the image's Node in a container limited to ProofLimitBytes, with and
// without Ceiling, and checks Node accepts the flag and sizes the heap to about three
// quarters of the limit rather than of the machine.
func ProveCeiling(run Runner, image string) error {
	plain, err := heapLimit(run, image, "")
	if err != nil {
		return fmt.Errorf("node without NODE_OPTIONS: %w", err)
	}
	lifted, err := heapLimit(run, image, Ceiling)
	if err != nil {
		return fmt.Errorf("node with NODE_OPTIONS=%s: %w", Ceiling, err)
	}
	share := lifted / ProofLimitBytes
	if share < minCeilingShare || share > maxCeilingShare {
		return fmt.Errorf("heap limit is %.2f of the container limit, want %.2f to %.2f", share, minCeilingShare, maxCeilingShare)
	}
	if lifted <= plain {
		return fmt.Errorf("heap limit %.0f with the ceiling is not above Node's own %.0f", lifted, plain)
	}
	return nil
}

func heapLimit(run Runner, image, nodeOptions string) (float64, error) {
	out, err := run("docker", "run", "--rm",
		"--memory", strconv.Itoa(ProofLimitBytes),
		"-e", "NODE_OPTIONS="+nodeOptions,
		image,
		"node", "-e", "process.stdout.write(String(require('v8').getHeapStatistics().heap_size_limit))",
	)
	if err != nil {
		return 0, err
	}
	limit, err := strconv.ParseFloat(strings.TrimSpace(out), 64)
	if err != nil {
		return 0, fmt.Errorf("read heap limit %q: %w", out, err)
	}
	return limit, nil
}

// ExecRunner runs commands on this machine, answering stderr in the error.
func ExecRunner(name string, args ...string) (string, error) {
	var stderr bytes.Buffer
	cmd := exec.CommandContext(context.Background(), name, args...)
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return "", errors.Join(err, errors.New(strings.TrimSpace(stderr.String())))
	}
	return string(out), nil
}
