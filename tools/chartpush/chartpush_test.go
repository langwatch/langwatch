package chartpush

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

var digest = "sha256:" + strings.Repeat("a", 64)

type call struct{ pkg, ref string }

// stubHelm answers a push the way the registry would and records each call.
func stubHelm(calls *[]call, output string, err error) Pusher {
	return func(_ context.Context, pkg, ref string) (string, error) {
		*calls = append(*calls, call{filepath.Base(pkg), ref})
		return output, err
	}
}

func packagesDir(t *testing.T, names ...string) string {
	t.Helper()
	dir := t.TempDir()
	for _, n := range names {
		if err := os.WriteFile(filepath.Join(dir, n), []byte("chart"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	return dir
}

/** @scenario "A merge to main publishes every prerelease chart to ECR" */
func TestPushGivenEveryPackagedChart(t *testing.T) {
	var calls []call
	packages := map[string]string{
		"clickhouse-serverless": "clickhouse-serverless-0.2.0-main.80.1.abc1234.tgz",
		"langwatch-gateway":     "langwatch-gateway-1.0.0-main.80.1.abc1234.tgz",
		"langwatch-langyagent":  "langwatch-langyagent-3.21.0-main.80.1.abc1234.tgz",
		"langwatch":             "langwatch-3.21.0-main.80.1.abc1234.tgz",
	}
	charts := []string{"clickhouse-serverless", "langwatch-gateway", "langwatch-langyagent", "langwatch"}
	files := make([]string, 0, len(charts))
	for _, chart := range charts {
		files = append(files, packages[chart])
	}
	results, err := Push(context.Background(), Options{
		Registry: "registry.example", Charts: charts, PackagesDir: packagesDir(t, files...),
		Push: stubHelm(&calls, "Pushed: registry.example/langwatch-charts/chart\nDigest: "+digest+"\n", nil),
	})
	if err != nil {
		t.Fatalf("push failed: %v", err)
	}
	if len(calls) != len(charts) || len(results) != len(charts) {
		t.Fatalf("pushes each chart once and nothing else: got %v", calls)
	}
	for i, chart := range charts {
		if calls[i] != (call{packages[chart], "oci://registry.example/langwatch-charts"}) {
			t.Errorf("pushes %s's own package under langwatch-charts: got %v", chart, calls[i])
		}
		version := strings.TrimSuffix(strings.TrimPrefix(packages[chart], chart+"-"), ".tgz")
		line := "- ECR `langwatch-charts/" + chart + ":" + version + "` `" + digest + "`"
		if results[i].SummaryLine() != line {
			t.Errorf("summary line: got %q, want %q", results[i].SummaryLine(), line)
		}
	}
}

/** @scenario "A missing or ambiguous chart package fails the run" */
func TestPushGivenNoOrTwoPackages(t *testing.T) {
	for name, files := range map[string][]string{
		"found 0": nil,
		"found 2": {"langwatch-langyagent-1.tgz", "langwatch-langyagent-2.tgz"},
	} {
		t.Run(name, func(t *testing.T) {
			var calls []call
			_, err := Push(context.Background(), Options{
				Registry: "registry.example", Charts: []string{"langwatch-langyagent"}, PackagesDir: packagesDir(t, files...),
				Push: stubHelm(&calls, "Digest: "+digest, nil),
			})
			if err == nil || !strings.Contains(err.Error(), "expected one packaged langwatch-langyagent chart, "+name) {
				t.Fatalf("want an error naming the chart and the count, got %v", err)
			}
			if len(calls) != 0 {
				t.Fatalf("pushed despite the package count: %v", calls)
			}
		})
	}
}

/** @scenario "A rejected push fails the run with the registry's reason" */
func TestPushGivenTheRegistryRefusesOrPrintsNoDigest(t *testing.T) {
	cases := map[string]struct {
		output string
		err    error
		want   string
	}{
		"refused":   {"Error: unexpected status from POST request: 403 Forbidden", errors.New("exit status 1"), "403 Forbidden"},
		"no digest": {"Pushed: registry.example/langwatch-charts/langwatch-langyagent", nil, "unexpected digest"},
		"garbled":   {"Digest: sha256:nothex", nil, "unexpected digest"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			var calls []call
			results, err := Push(context.Background(), Options{
				Registry: "registry.example", Charts: []string{"langwatch-langyagent"},
				PackagesDir: packagesDir(t, "langwatch-langyagent-1.tgz"),
				Push:        stubHelm(&calls, c.output, c.err),
			})
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want an error containing %q, got %v", c.want, err)
			}
			if len(results) != 0 {
				t.Fatalf("reported a digest for a push that failed: %v", results)
			}
		})
	}
}
