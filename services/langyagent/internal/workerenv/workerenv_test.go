package workerenv_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/langwatch/langwatch/services/langyagent/internal/workerenv"
)

// The `langwatch` CLI in the worker image is compiled with Bun, and Bun can
// auto-upload a crash report to a third party. A Bun crash report reprints the
// process argv, and argv for `langwatch ui call` carries the customer's own
// payload. The image sets DO_NOT_TRACK=1 to stop that upload, but the CLI runs
// in the WORKER, not in the manager, so the setting only reaches it through
// the inheritance allowlist. Either half alone does nothing.
//
// @scenario "The CLI never uploads a crash report out of a worker"
func TestBaseEnv_CarriesCrashReportOptOutToTheWorker(t *testing.T) {
	t.Setenv("DO_NOT_TRACK", "1")

	env := workerenv.BaseEnv()

	hasCrashReportOptOut := false
	for _, kv := range env {
		if kv == "DO_NOT_TRACK=1" {
			hasCrashReportOptOut = true
			break
		}
	}
	if !hasCrashReportOptOut {
		t.Fatalf("worker env does not carry DO_NOT_TRACK=1, got %v", env)
	}
}

// The allowlist entry above is inert unless the image actually sets the
// variable, so the two are asserted together.
//
// @scenario "The CLI never uploads a crash report out of a worker"
func TestWorkerImage_TurnsTheCrashReportUploadOff(t *testing.T) {
	path := filepath.Join("..", "..", "..", "..", "infra", "docker", "Dockerfile.langyagent")
	body, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if !strings.Contains(string(body), "ENV DO_NOT_TRACK=1") {
		t.Fatalf("%s does not set DO_NOT_TRACK=1", path)
	}
}
