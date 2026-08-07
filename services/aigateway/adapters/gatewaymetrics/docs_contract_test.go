package gatewaymetrics

import (
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"
)

// The published docs are the contract for this package. A self-hoster has
// no access to LangWatch's own dashboards, so whatever the observability
// pages tell them to scrape has to exist. The metrics package was deleted
// once in a restructure while the docs kept advertising it, and the only
// signal was operators scraping an endpoint that was not served.
//
// These tests tie the two together in both directions: nothing documented
// may be unregistered, and nothing registered may be undocumented. Either
// way the build fails and names the offender.

// docsRoots are the trees scanned for metric names.
var docsRoots = []string{"docs", "charts"}

// selectorPattern matches a documented PromQL selector, so the label
// names an operator is told to filter on can be checked too. A wrong label
// is as broken as a wrong name: an alert on gateway_auth_cache_hits_total
// with the label spelled `layer` instead of `tier` silently matches
// nothing and never fires.
var selectorPattern = regexp.MustCompile(`(?:^|[^A-Za-z0-9_])(gateway_[a-z0-9_]+)\{([^}]*)\}`)

// labelNamePattern picks label names out of a selector body.
var labelNamePattern = regexp.MustCompile(`([a-zA-Z_][a-zA-Z0-9_]*)\s*[=!~]`)

// scrapeTimeLabels are attached by Prometheus service discovery, not by
// the gateway, so a doc may legitimately filter on them.
var scrapeTimeLabels = map[string]bool{
	"namespace": true,
	"pod":       true,
	"instance":  true,
	"job":       true,
	"container": true,
	"le":        true,
}

// metricNamePattern matches a metric-shaped token. The leading guard stops
// a longer identifier from being chopped up: without it `lw_gateway_rps`
// yields `gateway_rps` and `release_ui_ai_gateway_menu_enabled` yields
// `gateway_menu_enabled`, neither of which is a metric.
var metricNamePattern = regexp.MustCompile(`(?:^|[^A-Za-z0-9_])(gateway_[a-z0-9_]+)`)

// notMetrics are `gateway_`-prefixed tokens that appear in the docs for
// some other reason. Grouped by what they actually are, because the next
// person to hit a failure here needs to know whether to register a metric
// or extend this list.
var notMetrics = map[string]string{
	// ClickHouse tables, views and materialized views on the control plane.
	"gateway_activity_events":        "ClickHouse table",
	"gateway_budget_ledger":          "ClickHouse view",
	"gateway_budget_ledger_events":   "ClickHouse table",
	"gateway_budget_scope_totals":    "ClickHouse rollup table",
	"gateway_budget_scope_totals_mv": "ClickHouse materialized view",
	"gateway_spend":                  "ClickHouse table (the billing spend ledger)",

	// Structured log event names. gateway_draining is deliberately absent
	// from this list: it is both a log event and a real gauge, so it has
	// to resolve as a metric.
	"gateway_listening":        "structured log event",
	"gateway_shutting_down":    "structured log event",
	"gateway_stopped":          "structured log event",
	"gateway_effective_config": "structured log event",

	// Log fields and JSON keys.
	"gateway_request_id": "log field and response-header value",

	// `error.code` values on the REST error envelope. They share the
	// `gateway_` prefix with the metrics because they name the same
	// subsystem, but they are values inside a JSON body, not series.
	"gateway_scope_org_mismatch":          "REST error code",
	"gateway_budget_cycle_anchor_invalid": "REST error code",

	// SDK facade names. The python SDK exposes each resource as a
	// snake_case attribute, so a documented call reads as a
	// `gateway_`-prefixed token without naming a series.
	"gateway_budgets": "python SDK facade name",
}

// plannedMetrics are names the docs explicitly describe as not yet
// shipped. They must stay unregistered: if one gets implemented, it moves
// out of here and the doc stops calling it a follow-up.
var plannedMetrics = map[string]string{
	"gateway_vk_grace_window_hit_total": "documented as a v1.1 follow-up",
}

// histogramSuffixes are appended by PromQL to a histogram's derived
// series and are not metric names of their own.
var histogramSuffixes = []string{"_bucket", "_sum", "_count"}

func TestDocumentedMetricsAreRegistered(t *testing.T) {
	registered := registeredNames(t)
	documented := documentedNames(t)

	require.NotEmpty(t, documented, "found no metric names in the docs, the scanner is broken")

	for name, files := range documented {
		if reason, ok := plannedMetrics[name]; ok {
			require.NotContains(t, registered, name,
				"%s is registered but the docs still describe it as unshipped (%s) in %s: implement it and update the doc, or drop it",
				name, reason, strings.Join(files, ", "))
			continue
		}
		require.Contains(t, registered, name,
			"%s is documented in %s but no collector registers it. A self-hoster following those docs would scrape nothing. Register it in metrics.go, or fix the docs if the metric is gone.",
			name, strings.Join(files, ", "))
	}
}

func TestRegisteredMetricsAreDocumented(t *testing.T) {
	documented := documentedNames(t)

	for _, name := range registeredNames(t) {
		if !strings.HasPrefix(name, "gateway_") {
			continue // Go runtime and process collectors.
		}
		require.Contains(t, documented, name,
			"%s is registered but no doc mentions it. An operator has no way to discover it, and nothing stops the next restructure from dropping it. Document it under docs/ai-gateway/observability.mdx.",
			name)
	}
}

// registeredNames is what the recorder actually declares, read back off
// the registry rather than from a list somebody has to remember to update.
func registeredNames(t *testing.T) []string {
	t.Helper()
	var names []string
	for _, m := range registeredMetrics(t) {
		names = append(names, m.Name)
	}
	return names
}

func registeredMetrics(t *testing.T) []Declared {
	t.Helper()
	declared := New().DeclaredMetrics()
	require.NotEmpty(t, declared)
	return declared
}

func TestDocumentedLabelsExist(t *testing.T) {
	labels := map[string]map[string]bool{}
	for _, m := range registeredMetrics(t) {
		if labels[m.Name] == nil {
			labels[m.Name] = map[string]bool{}
		}
		for _, l := range m.Labels {
			labels[m.Name][l] = true
		}
	}

	root := repoRoot(t)
	checked := 0
	for _, path := range docFiles(t, root) {
		body, err := os.ReadFile(path)
		require.NoError(t, err)
		rel, _ := filepath.Rel(root, path)

		for _, sel := range selectorPattern.FindAllStringSubmatch(string(body), -1) {
			name := trimHistogramSuffix(sel[1])
			declared, ok := labels[name]
			if !ok {
				continue // Covered by TestDocumentedMetricsAreRegistered.
			}
			for _, l := range labelNamePattern.FindAllStringSubmatch(sel[2], -1) {
				label := l[1]
				if scrapeTimeLabels[label] {
					continue
				}
				checked++
				require.True(t, declared[label],
					"%s has no label %q, but %s filters on it. That selector matches nothing, so the query or alert silently never fires.",
					name, label, rel)
			}
		}
	}
	require.NotZero(t, checked, "found no label selectors in the docs, the scanner is broken")
}

// documentedNames maps every metric name found in the docs to the files
// it was found in, so a failure can point at what to fix.
func documentedNames(t *testing.T) map[string][]string {
	t.Helper()
	root := repoRoot(t)
	found := map[string][]string{}

	for _, path := range docFiles(t, root) {
		body, err := os.ReadFile(path)
		require.NoError(t, err)
		rel, _ := filepath.Rel(root, path)
		for _, m := range metricNamePattern.FindAllStringSubmatch(string(body), -1) {
			name := trimHistogramSuffix(m[1])
			if _, skip := notMetrics[name]; skip {
				continue
			}
			if !contains(found[name], rel) {
				found[name] = append(found[name], rel)
			}
		}
	}

	for name := range found {
		sort.Strings(found[name])
	}
	return found
}

// docFiles lists every documentation file the metric contract is checked
// against.
func docFiles(t *testing.T, root string) []string {
	t.Helper()
	var paths []string
	for _, dir := range docsRoots {
		base := filepath.Join(root, dir)
		err := filepath.WalkDir(base, func(path string, d os.DirEntry, err error) error {
			if err != nil {
				return err
			}
			if !d.IsDir() && isDocFile(path) {
				paths = append(paths, path)
			}
			return nil
		})
		require.NoError(t, err, "scanning %s", base)
	}
	sort.Strings(paths)
	return paths
}

func isDocFile(path string) bool {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".md", ".mdx", ".yaml", ".yml", ".json":
		return true
	}
	return false
}

func trimHistogramSuffix(name string) string {
	for _, suffix := range histogramSuffixes {
		if strings.HasSuffix(name, suffix) {
			return strings.TrimSuffix(name, suffix)
		}
	}
	return name
}

func contains(haystack []string, needle string) bool {
	for _, v := range haystack {
		if v == needle {
			return true
		}
	}
	return false
}

// repoRoot walks up from the test's package directory to the module root,
// so the scan does not depend on where the test was invoked from.
func repoRoot(t *testing.T) string {
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
