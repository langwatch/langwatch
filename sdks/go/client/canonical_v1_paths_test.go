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
	// Routes the document keeps bare because they have no /api/v1 twin, including
	// Langy's in-process worker families, declared literal.
	bareOnly = regexp.MustCompile(`^/api/traces/[^/]+/transcript$|^/api/trace/(search|[^/]+(/share|/unshare)?)$|^/api/langy/(local|waits|ui)(/|$)`)
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

	type candidate struct {
		line int
		path string
	}
	var candidates []candidate
	published := map[string]struct{}{}
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
			published[match[0]] = struct{}{}
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
			candidates = append(candidates, candidate{line: line, path: match[0]})
		}
	}
	require.NoError(t, scanner.Err())

	// A bare path the document also publishes under /api/v1 has its twin; the
	// offence is a family route with no /api/v1 address at all.
	var offenders []string
	for _, c := range candidates {
		if _, twin := published["/api/v1"+strings.TrimPrefix(c.path, "/api")]; twin {
			continue
		}
		offenders = append(offenders, fmt.Sprintf("line %d: %s", c.line, c.path))
	}

	// A guard that read no paths would pass while proving nothing.
	assert.Greater(t, paths, 100)
	assert.Empty(t, offenders)
}

var v1PathPattern = regexp.MustCompile(`/api/v1((?:/[a-zA-Z0-9_%{}-]+)+)`)

// bareOnlyV1Paths lists the hand-written /api/v1 paths in source that name a
// route the document keeps bare, which has no /api/v1 twin to answer them.
func bareOnlyV1Paths(source, file string) []string {
	var offenders []string
	for _, match := range v1PathPattern.FindAllStringSubmatchIndex(source, -1) {
		path := "/api" + source[match[2]:match[3]]
		if bareOnly.MatchString(path) {
			line := strings.Count(source[:match[0]], "\n") + 1
			offenders = append(offenders, fmt.Sprintf("%s:%d %s", file, line, source[match[0]:match[1]]))
		}
	}
	return offenders
}

func TestHandWrittenPathsNameNoV1AddressForABareOnlyRoute(t *testing.T) {
	entries, err := os.ReadDir(".")
	require.NoError(t, err)

	var offenders []string
	files := 0
	for _, entry := range entries {
		name := entry.Name()
		if entry.IsDir() || !strings.HasSuffix(name, ".go") || strings.HasSuffix(name, "_test.go") {
			continue
		}
		source, err := os.ReadFile(name)
		require.NoError(t, err)
		files++
		offenders = append(offenders, bareOnlyV1Paths(string(source), name)...)
	}

	// A guard that read no files would pass while proving nothing.
	assert.Greater(t, files, 5)
	assert.Empty(t, offenders)
}

func TestBareOnlyGuardFlagsAV1AddressForABareOnlyRoute(t *testing.T) {
	source := "url := base + \"/api/v1/trace/\" + id + \"/share\"\npath := \"/api/v1/trace/abc/share\"\n"

	assert.Equal(t, []string{"x.go:2 /api/v1/trace/abc/share"}, bareOnlyV1Paths(source, "x.go"))
}
