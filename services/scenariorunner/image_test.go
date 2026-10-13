package scenariorunner

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// @scenario "The image builds the runner in its own Go stage and names its path to the worker"
func TestTheWorkerImageCarriesTheRunnerAsItsOwnBinary(t *testing.T) {
	raw, err := os.ReadFile(filepath.Join("..", "..", "infra", "docker", "Dockerfile"))
	require.NoError(t, err)
	dockerfile := string(raw)

	assert.Regexp(t, `(?m)^FROM .*golang:\S+ AS scenariorunner$`, dockerfile)
	assert.Regexp(t, `CGO_ENABLED=0 [^\n]*go build \\\n\s+-trimpath -ldflags="-s -w" -o /out/scenariorunner \./scenariorunner/cmd/scenariorunner`, dockerfile)
	assert.Contains(t, dockerfile, "COPY --from=scenariorunner /out/scenariorunner /usr/local/bin/scenariorunner")
	assert.Contains(t, dockerfile, "ENV SCENARIO_GO_RUNNER_PATH=/usr/local/bin/scenariorunner")
}
