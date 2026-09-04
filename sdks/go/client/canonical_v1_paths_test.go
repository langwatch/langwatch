package client

import (
	"bufio"
	"context"
	"fmt"
	"net/http"
	"os"
	"regexp"
	"strings"
	"sync"
	"testing"

	langwatch "github.com/langwatch/langwatch/sdks/go"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// v1Families are the families the served surface answers for at /api/v1 as
// well as bare (packages/api/adrs/002 section 1). Everything else — the
// sign-in door, the health probes, trace ingestion, and the families a
// different /api/v1 family supersedes — keeps the address it has.
var v1Families = strings.Fields(`agent-cache analytics annotations api-keys bug-reports
	coding-agent dashboards dataset dspy evaluations evaluators events experiment experiments
	governance graphs groups guardrails langy me model-defaults model-providers monitors
	optimization organization organizations playground prompts role-bindings roles
	scenario-events scenarios scim-tokens simulation-runs suites teams trace traces
	trigger triggers workflows`)

var (
	barePathPattern = regexp.MustCompile(`/api/([a-zA-Z0-9_-]+)((?:/[a-zA-Z0-9_%-]+)*)`)
	versionSegment  = regexp.MustCompile(`^v\d+$`)
	// Routes the document keeps bare because they have no /api/v1 twin.
	bareOnly = regexp.MustCompile(`^/api/traces/[^/]+/transcript$`)
)

// @scenario "The track-event path is v1-form"
func TestTrackEventAddressesTheCanonicalPath(t *testing.T) {
	var mu sync.Mutex
	var gotPath string
	c := newTestClient(t, func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		gotPath = r.URL.Path
		_, _ = w.Write([]byte(`{"message":"Event tracked"}`))
	})

	err := c.Events.Track(context.Background(), "trace_xyz", langwatch.Event{Type: "selected_text"})
	require.NoError(t, err)

	mu.Lock()
	defer mu.Unlock()
	assert.Equal(t, "/api/v1/events/track", gotPath)
}

// @scenario "The generated client's request paths are v1-form"
func TestGeneratedClientRequestPathsAreCanonical(t *testing.T) {
	file, err := os.Open("internal/openapi/zz_generated.gen.go")
	require.NoError(t, err)
	defer func() { _ = file.Close() }()

	families := make(map[string]struct{}, len(v1Families))
	for _, family := range v1Families {
		families[family] = struct{}{}
	}

	var offenders []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 1024*1024), 1024*1024)
	line := 0
	paths := 0
	for scanner.Scan() {
		line++
		text := scanner.Text()
		if !strings.Contains(text, "operationPath") {
			continue
		}
		for _, match := range barePathPattern.FindAllStringSubmatch(text, -1) {
			paths++
			if _, ok := families[match[1]]; !ok {
				continue
			}
			versioned := false
			for _, segment := range strings.Split(match[2], "/") {
				if versionSegment.MatchString(segment) {
					versioned = true
				}
			}
			if versioned || bareOnly.MatchString(match[0]) {
				continue
			}
			offenders = append(offenders, fmt.Sprintf("line %d: %s", line, match[0]))
		}
	}
	require.NoError(t, scanner.Err())

	// A guard that read no paths would pass while proving nothing.
	assert.Greater(t, paths, 100)
	assert.Empty(t, offenders)
}
