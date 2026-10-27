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

/** @scenario "A merge to main publishes the langyagent prerelease chart to ECR" */
func TestPushGivenOnePackagedChart(t *testing.T) {
	var calls []call
	dir := packagesDir(t, "langwatch-langyagent-3.21.0-main.80.1.abc1234.tgz", "langwatch-gateway-1.0.0-main.80.1.abc1234.tgz")
	results, err := Push(context.Background(), Options{
		Registry: "registry.example", Charts: []string{"langwatch-langyagent"}, PackagesDir: dir,
		Push: stubHelm(&calls, "Pushed: registry.example/langwatch-charts/langwatch-langyagent\nDigest: "+digest+"\n", nil),
	})
	if err != nil {
		t.Fatalf("push failed: %v", err)
	}
	want := []call{{"langwatch-langyagent-3.21.0-main.80.1.abc1234.tgz", "oci://registry.example/langwatch-charts"}}
	if len(calls) != 1 || calls[0] != want[0] {
		t.Fatalf("pushes the same package GHCR got, under langwatch-charts, and nothing else: got %v", calls)
	}
	line := "- ECR `langwatch-charts/langwatch-langyagent:3.21.0-main.80.1.abc1234` `" + digest + "`"
	if len(results) != 1 || results[0].SummaryLine() != line {
		t.Fatalf("summary line: got %v, want %q", results, line)
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
