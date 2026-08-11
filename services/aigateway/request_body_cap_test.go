package aigateway_test

import (
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/langwatch/langwatch/pkg/config"
)

// The inbound body cap is stated in three places that must agree: the Go
// constant every deployment falls back to, the Helm value the chart renders
// into the container, and the operator docs someone sizes a pod from. Nothing
// tied them together, and all three drifted to different numbers (128 MiB in
// Go, 10 MiB in the chart, 32 MiB in the docs), each one looking authoritative
// on its own. A self-hoster reading the docs provisioned for one cap and got
// another, and the only symptom is a 413 on a payload the docs promised would
// fit.
//
// These read the real files rather than restating the number, so a change to
// any one of them fails here until the other two follow.

// chartMaxRequestBodyBytes matches the Helm value the configmap renders into
// SERVER_MAX_REQUEST_BODY_BYTES.
var chartMaxRequestBodyBytes = regexp.MustCompile(`(?m)^\s*maxRequestBodyBytes:\s*(\d+)`)

// docsMaxRequestBodyBytes matches the default column of the
// SERVER_MAX_REQUEST_BODY_BYTES row in the self-hosting config table.
var docsMaxRequestBodyBytes = regexp.MustCompile("`SERVER_MAX_REQUEST_BODY_BYTES`\\s*\\|\\s*`(\\d+)`")

/** @scenario "the body cap is the same number in the code, the chart and the docs" */
func TestDefaultMaxRequestBodyBytesMatchesChart(t *testing.T) {
	root := bodyCapRepoRoot(t)

	chart := readBodyCap(t,
		filepath.Join(root, "charts", "gateway", "values.yaml"),
		chartMaxRequestBodyBytes)
	require.Equal(t, int64(config.DefaultMaxRequestBodyBytes), chart,
		"charts/gateway/values.yaml security.maxRequestBodyBytes disagrees with config.DefaultMaxRequestBodyBytes: a chart-deployed pod would enforce a different cap than every other deployment")

	docs := readBodyCap(t,
		filepath.Join(root, "docs", "ai-gateway", "self-hosting", "config.mdx"),
		docsMaxRequestBodyBytes)
	require.Equal(t, int64(config.DefaultMaxRequestBodyBytes), docs,
		"docs/ai-gateway/self-hosting/config.mdx documents a different default than config.DefaultMaxRequestBodyBytes: an operator sizing a pod from the docs would get a cap the gateway does not enforce")
}

// readBodyCap pulls the single capture group out of path, failing with the
// file name rather than a bare regexp miss so the next person knows which of
// the three sources moved.
func readBodyCap(t *testing.T, path string, pattern *regexp.Regexp) int64 {
	t.Helper()
	body, err := os.ReadFile(path)
	require.NoError(t, err)
	match := pattern.FindSubmatch(body)
	require.NotNil(t, match, "no body-cap value found in %s, the pattern went stale", path)
	value, err := strconv.ParseInt(string(match[1]), 10, 64)
	require.NoError(t, err)
	return value
}

func bodyCapRepoRoot(t *testing.T) string {
	t.Helper()
	dir, err := os.Getwd()
	require.NoError(t, err)
	for {
		if _, err := os.Stat(filepath.Join(dir, "go.mod")); err == nil {
			return dir
		}
		parent := filepath.Dir(dir)
		require.NotEqual(t, dir, parent, "walked past the filesystem root without finding go.mod")
		dir = parent
	}
}
