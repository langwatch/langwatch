package visualdiff

import (
	"bytes"
	"context"
	"io"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// @scenario "Every declared route is rendered, excluded or uncovered"
func TestEveryDeclaredRouteIsRenderedExcludedOrUncovered(t *testing.T) {
	var base []string
	for _, file := range []string{
		"[project]/datasets.tsx", "[project]/analytics/index.tsx", "settings/profile.tsx", "dev/error-test.tsx",
		"settings/api-keys/ApiKeysSection.tsx", "settings/api-keys/utils.ts", "_app.tsx", "api/health.ts",
		"auth/__tests__/signin.integration.test.tsx", "ops/backoffice/_shell.tsx", "[project]/simulations/simulations.css",
		"[project]/agent-testing/[[...path]].tsx",
	} {
		if pattern, ok := PagePattern(file); ok {
			base = append(base, pattern)
		}
	}
	coverage := ComputeCoverage(CoverageInputs{
		Base:      base,
		Candidate: []string{"/{slug}/datasets", "/settings/members"},
		Routes:    []string{"/{slug}/datasets", "/{slug}/analytics", "/{slug}/agent-testing", "/settings/gone"},
		Excluded:  []Exclusion{{Route: "/dev/**", Reason: "throws on purpose"}},
	})

	statuses := map[string]string{}
	for _, entry := range coverage.Entries {
		statuses[entry.Pattern] = entry.Status
	}
	want := map[string]string{
		"/{slug}/datasets": CoverageCovered, "/{slug}/analytics": CoverageCovered, "/{slug}/agent-testing": CoverageCovered,
		"/settings/profile": CoverageUncovered, "/settings/members": CoverageUncovered, "/dev/error-test": CoverageExcluded,
	}
	if len(statuses) != len(want) {
		t.Fatalf("patterns = %v, want exactly %v (helpers, tests, styles and api routes are not pages)", statuses, want)
	}
	for pattern, status := range want {
		if statuses[pattern] != status {
			t.Errorf("%s = %q, want %q", pattern, statuses[pattern], status)
		}
	}
	if line := coverage.Line(); line != "coverage 3/5 (1 excluded, 2 uncovered)" {
		t.Errorf("line = %q", line)
	}
	if len(coverage.Stale) != 1 || coverage.Stale[0] != "/settings/gone" {
		t.Errorf("stale = %v", coverage.Stale)
	}

	runDir := t.TempDir()
	path := filepath.Join(runDir, FindingsFile)
	if err := appendUncovered(path, coverage.Uncovered(), fixedClock("2026-09-28T00:00:00Z")()); err != nil {
		t.Fatal(err)
	}
	raw, _ := os.ReadFile(path)
	if count := strings.Count(string(raw), `"kind":"uncovered","finding":true`); count != 2 {
		t.Fatalf("each uncovered route is a finding line, got %d:\n%s", count, raw)
	}
}

// @scenario "A dynamic route renders a seeded fixture or stays uncovered"
func TestADynamicRouteRendersASeededFixtureOrStaysUncovered(t *testing.T) {
	trace, _ := PagePattern("[project]/traces/[trace].tsx")
	dataset, _ := PagePattern("[project]/datasets/[id].tsx")
	workbench, _ := PagePattern("[project]/experiments/workbench/[slug].tsx")
	if workbench != "/{slug}/experiments/workbench/{entitySlug}" {
		t.Fatalf("a [slug] parameter must not read as the project: %s", workbench)
	}
	coverage := ComputeCoverage(CoverageInputs{Base: []string{trace, dataset}, Routes: []string{"/{slug}/traces/{trace}"}})

	for _, entry := range coverage.Entries {
		want := CoverageUncovered
		if entry.Pattern == "/{slug}/traces/{trace}" {
			want = CoverageCovered
		}
		if entry.Status != want || !entry.Dynamic() {
			t.Errorf("%s = %s (dynamic %v), want %s", entry.Pattern, entry.Status, entry.Dynamic(), want)
		}
	}

	config := &Config{Routes: []string{"/{slug}/traces/{trace}"}}
	if err := config.Validate(); err == nil || !strings.Contains(err.Error(), "{trace}") {
		t.Fatalf("a placeholder no fixture fills is refused, got %v", err)
	}
	config.Fixtures = map[string]string{"trace": SeedTraceIDPrefix + "0"}
	if err := config.Validate(); err != nil {
		t.Fatal(err)
	}
}

// @scenario "A candidate screen's declared path wins over its key"
func TestACandidateScreensDeclaredPathWinsOverItsKey(t *testing.T) {
	output := strings.Join([]string{
		"HEAD:modules/governance/browser/src/governance.web.ts\x0012\x00    \"pages/governance/inventory.enterprise\": {",
		"HEAD:modules/governance/browser/src/governance.web.ts\x0013\x00      path: \"/governance/inventory\",",
		"HEAD:modules/governance/browser/src/governance.web.ts\x0020\x00    \"pages/governance/teams/[id]\": {",
		"HEAD:modules/dataset/browser/src/dataset.web.ts\x0015\x00    \"pages/[project]/datasets\": {",
		"HEAD:modules/dataset/browser/src/dataset.web.ts\x0016\x00      path: \"/:project/datasets/:id\",",
		"HEAD:modules/trace/browser/src/trace.web.ts\x009\x00    \"pages/[project]/traces/index\": {",
	}, "\n")

	patterns := ParseScreenDeclarations(output)

	want := []string{"/governance/inventory", "/governance/teams/{id}", "/{slug}/datasets/{id}", "/{slug}/traces"}
	if strings.Join(patterns, " ") != strings.Join(want, " ") {
		t.Fatalf("patterns = %v, want %v", patterns, want)
	}
}

// @scenario "An exclusion without a reason is refused"
func TestAnExclusionWithoutAReasonIsRefused(t *testing.T) {
	config := &Config{Routes: []string{"/a"}, Coverage: CoverageConfig{Excluded: []Exclusion{{Route: "/dev/**"}}}}

	err := config.Validate()

	if err == nil || !strings.Contains(err.Error(), "/dev/**") {
		t.Fatalf("got %v", err)
	}
}

// @scenario "A dirty HEAD candidate is warned about"
func TestADirtyHeadCandidateIsWarnedAbout(t *testing.T) {
	dirty := func(_ context.Context, spec commandSpec, out io.Writer) error {
		if spec.name == "git" && spec.args[0] == "status" {
			_, _ = io.WriteString(out, " M apps/ui/src/main.tsx\n M modules/trace/x.ts\n")
		}
		return nil
	}
	var stderr bytes.Buffer

	warnDirtyCandidate(context.Background(), Request{Options: Options{CandidateRef: "HEAD"}, Deps: Deps{Run: dirty}}, &stderr)
	mustContain(t, stderr.String(), "2 tracked files have uncommitted changes")

	stderr.Reset()
	warnDirtyCandidate(context.Background(), Request{Options: Options{CandidateRef: "feat/x"}, Deps: Deps{Run: dirty}}, &stderr)
	if stderr.Len() != 0 {
		t.Fatalf("a named candidate ref is rendered as committed, no warning: %s", stderr.String())
	}
}
