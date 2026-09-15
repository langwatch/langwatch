package visualdiff

import (
	"bytes"
	"context"
	"path/filepath"
	"testing"
)

func writeRepoConfig(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	mustWrite(t, filepath.Join(root, ConfigFile), sampleConfig)
	return root
}

// @scenario A dry run prints the plan and starts nothing
func TestCLIDryRunPrintsThePlan(t *testing.T) {
	root := writeRepoConfig(t)
	stdout, stderr := &bytes.Buffer{}, &bytes.Buffer{}

	// -no-haven keeps this deterministic regardless of whether the machine
	// running the test happens to have haven on PATH: this test is about the
	// flow list, not about which boot path is selected.
	code := Run(context.Background(), []string{"run", "-root", root, "-dry-run", "-no-haven"}, Streams{Out: stdout, Err: stderr})

	if code != ExitClean {
		t.Fatalf("exit %d: %s", code, stderr.String())
	}
	mustContain(t, stdout.String(), "dry run")
	mustContain(t, stdout.String(), "automation-create, prompt-create")
}

// @scenario An unknown action in visualdiff.yaml is refused before anything boots
func TestCLIRefusesAnUnknownFlowName(t *testing.T) {
	root := writeRepoConfig(t)
	stderr := &bytes.Buffer{}

	code := Run(context.Background(), []string{"run", "-root", root, "-flows", "nope", "-dry-run", "-no-haven"}, Streams{Out: &bytes.Buffer{}, Err: stderr})

	if code != ExitOperational {
		t.Fatalf("exit %d", code)
	}
	mustContain(t, stderr.String(), "no such flow: nope")
}

// @scenario The viewport is configurable
func TestCLIViewportOverridesTheConfiguredOne(t *testing.T) {
	root := writeRepoConfig(t)
	stdout := &bytes.Buffer{}

	code := Run(context.Background(), []string{"run", "-root", root, "-viewport", "390x844", "-dry-run", "-no-haven"}, Streams{Out: stdout, Err: &bytes.Buffer{}})

	if code != ExitClean {
		t.Fatalf("exit %d", code)
	}
	mustContain(t, stdout.String(), "390x844")
}

// @scenario The viewport is configurable
func TestCLIFallsBackToTheConfiguredViewport(t *testing.T) {
	root := writeRepoConfig(t)
	stdout := &bytes.Buffer{}

	Run(context.Background(), []string{"run", "-root", root, "-dry-run", "-no-haven"}, Streams{Out: stdout, Err: &bytes.Buffer{}})

	mustContain(t, stdout.String(), "1440x900")
}

func TestCLIRefusesAnUnknownCommand(t *testing.T) {
	stderr := &bytes.Buffer{}

	if code := Run(context.Background(), []string{"fly"}, Streams{Out: &bytes.Buffer{}, Err: stderr}); code != ExitOperational {
		t.Fatalf("exit %d", code)
	}
	mustContain(t, stderr.String(), "unknown command")
}

func TestCLIHelpExitsClean(t *testing.T) {
	stdout := &bytes.Buffer{}

	if code := Run(context.Background(), []string{"--help"}, Streams{Out: stdout, Err: &bytes.Buffer{}}); code != ExitClean {
		t.Fatalf("exit %d", code)
	}
	mustContain(t, stdout.String(), "visualdiff run")
}
