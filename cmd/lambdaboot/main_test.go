package main

import (
	"bytes"
	"context"
	"errors"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/tools/lambdaboot"
)

// noDocker fails the test if the command reaches docker at all.
func noDocker(t *testing.T) lambdaboot.Runtime {
	t.Helper()
	return lambdaboot.Runtime{
		Docker: func(context.Context, ...string) (string, error) {
			t.Error("reached docker")
			return "", errors.New("no docker in this test")
		},
		Probe: func(context.Context, string) (int, error) { return 0, errors.New("no probe") },
		Stat: func(context.Context, string, string) (lambdaboot.Entry, error) {
			return lambdaboot.Entry{}, errors.New("no stat")
		},
	}
}

func TestRunWhenNoImageIsGiven(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run(nil, noDocker(t), output{out: &stdout, err: &stderr}); code != 2 {
		t.Errorf("exit code %d, want 2", code)
	}
	if !strings.Contains(stderr.String(), "-image is required") {
		t.Errorf("stderr %q does not name the missing flag", stderr.String())
	}
}

func TestRunWhenAskedToCheckAsRoot(t *testing.T) {
	var stdout, stderr bytes.Buffer
	code := run([]string{"-image", "langwatch-nlp-lambda:boot-check", "-user", "0:0"}, noDocker(t), output{out: &stdout, err: &stderr})
	if code != 1 {
		t.Errorf("exit code %d, want 1", code)
	}
	if !strings.Contains(stderr.String(), "::error::langwatch-nlp-lambda:boot-check") {
		t.Errorf("stderr %q is not a GitHub error naming the image", stderr.String())
	}
}

func TestRunWhenTheImageStarts(t *testing.T) {
	rt := lambdaboot.Runtime{
		Docker: func(_ context.Context, args ...string) (string, error) {
			switch args[0] {
			case "image":
				return "/", nil
			case "run":
				return "c1", nil
			case "port":
				return "127.0.0.1:49153", nil
			}
			return "", nil
		},
		Probe: func(context.Context, string) (int, error) { return 200, nil },
	}
	var stdout, stderr bytes.Buffer
	code := run([]string{"-image", "img:t", "-e", "STUDIO_RUNTIME=async"}, rt, output{out: &stdout, err: &stderr})
	if code != 0 {
		t.Fatalf("exit code %d, stderr %q", code, stderr.String())
	}
	if !strings.Contains(stdout.String(), "img:t started as user 9999:9999") {
		t.Errorf("stdout %q does not report the start", stdout.String())
	}
}

func TestRunWhenAFlagIsUnknown(t *testing.T) {
	var stdout, stderr bytes.Buffer
	if code := run([]string{"-nope"}, noDocker(t), output{out: &stdout, err: &stderr}); code != 2 {
		t.Errorf("exit code %d, want 2", code)
	}
}
